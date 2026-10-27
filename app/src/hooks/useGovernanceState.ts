import {
	type LedgerWindow,
	type PendingAdmins,
	type PendingTransfer,
	readContract,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault, shareToken } from "../config/clients"
import { type PendingChange } from "../pages/pendingChanges"
import { type GovernedContract, pendingAdminsQuery } from "./pendingAdmins"
import { useConfigurationState } from "./useConfigurationState"
import { type CycleWindDown, useCycleReads } from "./useCycleState"
import { type TimelockedContract } from "./useSetupOpen"
import { type PauseState, useVaultPaused } from "./useVaultPaused"

const STALE_MS = 30_000
const REFRESH_MS = 15_000

const PENDING_CHANGES_KEYS = {
	vault: ["governance", "pendingChanges"],
	token: ["governance", "tokenPendingChanges"],
} as const

export const pendingChangesKey = <C extends TimelockedContract>(contract: C) =>
	PENDING_CHANGES_KEYS[contract]

export type Handovers =
	| { status: "checking" }
	| { status: "unreadable" }
	| {
			status: "ready"
			ledger: LedgerWindow
			pending: Record<GovernedContract, PendingTransfer | null>
	  }

export type Upgrades =
	| { status: "checking" }
	| {
			status: "ready"
			pending: PendingChange[] | undefined
			setupOpen: boolean | null
			delay: bigint | null
			notice: bigint | null
			windDown: CycleWindDown
			now: bigint | null
			paused: PauseState
	  }

type PendingRead = { pending: PendingChange[] | undefined }

const PENDING_READERS = {
	vault: async () => (await asyncVault()).pending_changes(),
	token: async () => (await shareToken()).pending_changes(),
} satisfies Record<TimelockedContract, unknown>

async function fetchPendingChanges(
	contract: TimelockedContract,
): Promise<PendingRead> {
	const read = await readContract<PendingChange[]>(PENDING_READERS[contract])
	return { pending: read.kind === "value" ? read.value : undefined }
}

export const pendingChangesQuery = (contract: TimelockedContract) => ({
	queryKey: pendingChangesKey(contract),
	queryFn: () => fetchPendingChanges(contract),
})

const SETUP_FLAGS = {
	vault: "setupOpen",
	token: "tokenSetupOpen",
} as const satisfies Record<TimelockedContract, string>

const usePendingChanges = (contract: TimelockedContract) =>
	useQuery({
		...pendingChangesQuery(contract),
		staleTime: STALE_MS,
		refetchInterval: REFRESH_MS,
	}).data

function useUpgrades(): Record<TimelockedContract, Upgrades> {
	const cycle = useCycleReads()
	const { configuration } = useConfigurationState()
	const { pause } = useVaultPaused({ poll: true })
	const reads = {
		vault: usePendingChanges("vault"),
		token: usePendingChanges("token"),
	}
	const upgradesOf = (contract: TimelockedContract): Upgrades => {
		const data = reads[contract]
		if (
			cycle === undefined ||
			data === undefined ||
			configuration.status !== "ready"
		)
			return { status: "checking" }
		return {
			status: "ready",
			pending: data.pending,
			setupOpen: configuration[SETUP_FLAGS[contract]],
			delay: configuration.upgradeDelay,
			notice: configuration.notice,
			windDown: cycle.windDown,
			now: cycle.ledgerTime,
			paused: pause,
		}
	}
	return { vault: upgradesOf("vault"), token: upgradesOf("token") }
}

function toHandovers(
	read: PendingAdmins,
	contracts: Record<GovernedContract, string>,
): Handovers {
	const pendingOf = (contract: GovernedContract) =>
		read.pending.get(contracts[contract]) ?? null
	return {
		status: "ready",
		ledger: read.ledger,
		pending: {
			vault: pendingOf("vault"),
			oracle: pendingOf("oracle"),
			token: pendingOf("token"),
		},
	}
}

export function useGovernanceState({
	contracts,
}: {
	contracts: Record<GovernedContract, string> | undefined
}): {
	handovers: Handovers
	upgrades: Record<TimelockedContract, Upgrades>
} {
	const { data, isError } = useQuery({
		...pendingAdminsQuery(contracts),
		refetchInterval: REFRESH_MS,
	})
	const upgrades = useUpgrades()
	let handovers: Handovers = { status: "checking" }
	if (data !== undefined && contracts !== undefined)
		handovers = toHandovers(data, contracts)
	else if (isError) handovers = { status: "unreadable" }
	return { handovers, upgrades }
}

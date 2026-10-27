import {
	type LedgerWindow,
	type PendingAdmins,
	type PendingTransfer,
	readContract,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"
import { type PendingChange } from "../pages/pendingChanges"
import { type GovernedContract, pendingAdminsQuery } from "./pendingAdmins"
import { useConfigurationState } from "./useConfigurationState"
import { type CycleWindDown, useCycleReads } from "./useCycleState"
import { type PauseState, useVaultPaused } from "./useVaultPaused"

const STALE_MS = 30_000
const REFRESH_MS = 15_000

export const pendingChangesKey = ["governance", "pendingChanges"] as const

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

async function fetchPendingChanges(): Promise<PendingRead> {
	const read = await readContract(async () =>
		(await asyncVault()).pending_changes(),
	)
	return { pending: read.kind === "value" ? read.value : undefined }
}

export const pendingChangesQuery = {
	queryKey: pendingChangesKey,
	queryFn: fetchPendingChanges,
}

function useUpgrades(): Upgrades {
	const cycle = useCycleReads()
	const { configuration } = useConfigurationState()
	const { pause } = useVaultPaused({ poll: true })
	const { data } = useQuery({
		...pendingChangesQuery,
		staleTime: STALE_MS,
		refetchInterval: REFRESH_MS,
	})
	if (
		cycle === undefined ||
		data === undefined ||
		configuration.status !== "ready"
	)
		return { status: "checking" }
	return {
		status: "ready",
		pending: data.pending,
		setupOpen: configuration.setupOpen,
		delay: configuration.upgradeDelay,
		notice: configuration.notice,
		windDown: cycle.windDown,
		now: cycle.ledgerTime,
		paused: pause,
	}
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
}): { handovers: Handovers; upgrades: Upgrades } {
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

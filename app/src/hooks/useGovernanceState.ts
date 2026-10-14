import {
	type LedgerWindow,
	type PendingAdmins,
	type PendingTransfer,
	readContract,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"
import { type GovernedContract, pendingAdminsQuery } from "./pendingAdmins"
import { useConfigurationState } from "./useConfigurationState"
import { type CycleWindDown, useCycleReads } from "./useCycleState"
import { type PauseState, useVaultPaused } from "./useVaultPaused"

const STALE_MS = 30_000
const REFRESH_MS = 15_000

export const upgradeProposalKey = ["governance", "upgradeProposal"] as const

export type Handovers =
	| { status: "checking" }
	| { status: "unreadable" }
	| {
			status: "ready"
			ledger: LedgerWindow
			pending: Record<GovernedContract, PendingTransfer | null>
	  }

export type PendingUpgrade =
	| { kind: "code"; hash: string; eta: bigint }
	| { kind: "delay"; secs: bigint; eta: bigint }

export type Upgrades =
	| { status: "checking" }
	| {
			status: "ready"
			proposal: PendingUpgrade | null | undefined
			delay: bigint | null
			notice: bigint | null
			windDown: CycleWindDown
			now: bigint | null
			paused: PauseState
	  }

type ProposalRead = { proposal: PendingUpgrade | null | undefined }

async function fetchUpgradeProposal(): Promise<ProposalRead> {
	const read = await readContract(async () =>
		(await asyncVault()).upgrade_proposal(),
	)
	if (read.kind !== "value") return { proposal: undefined }
	if (read.value === null) return { proposal: null }
	const { action, eta } = read.value
	return {
		proposal:
			action.tag === "Wasm"
				? { kind: "code", hash: action.values[0].toString("hex"), eta }
				: { kind: "delay", secs: action.values[0], eta },
	}
}

function useUpgrades(active: boolean): Upgrades {
	const cycle = useCycleReads(active)
	const { configuration } = useConfigurationState({ active })
	const { pause } = useVaultPaused({ poll: active })
	const { data } = useQuery({
		queryKey: upgradeProposalKey,
		queryFn: fetchUpgradeProposal,
		staleTime: STALE_MS,
		refetchInterval: active ? REFRESH_MS : false,
	})
	if (
		cycle === undefined ||
		data === undefined ||
		configuration.status !== "ready"
	)
		return { status: "checking" }
	return {
		status: "ready",
		proposal: data.proposal,
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
	active = true,
}: {
	contracts: Record<GovernedContract, string> | undefined
	active?: boolean
}): { handovers: Handovers; upgrades: Upgrades } {
	const { data, isError } = useQuery({
		...pendingAdminsQuery(contracts),
		refetchInterval: active ? REFRESH_MS : false,
	})
	const upgrades = useUpgrades(active)
	let handovers: Handovers = { status: "checking" }
	if (data !== undefined && contracts !== undefined)
		handovers = toHandovers(data, contracts)
	else if (isError) handovers = { status: "unreadable" }
	return { handovers, upgrades }
}

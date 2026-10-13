import {
	type LedgerWindow,
	type PendingTransfer,
	readPendingAdmins,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"

const STALE_MS = 30_000
const REFRESH_MS = 15_000

export const governanceReadsKey = ["governance", "reads"] as const

export type GovernedContract = "vault" | "oracle" | "token"

export const GOVERNED_CONTRACTS: GovernedContract[] = [
	"vault",
	"oracle",
	"token",
]

export type Handovers =
	| { status: "checking" }
	| { status: "unreadable" }
	| {
			status: "ready"
			ledger: LedgerWindow
			pending: Record<GovernedContract, PendingTransfer | null>
	  }

async function fetchHandovers(
	contracts: Record<GovernedContract, string>,
): Promise<Handovers> {
	const read = await readPendingAdmins(
		GOVERNED_CONTRACTS.map((contract) => contracts[contract]),
	)
	if (read.kind !== "value") return { status: "unreadable" }
	const pendingOf = (contract: GovernedContract) =>
		read.value.pending.get(contracts[contract]) ?? null
	return {
		status: "ready",
		ledger: read.value.ledger,
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
	contracts: Record<GovernedContract, string>
	active?: boolean
}): { handovers: Handovers } {
	const { data } = useQuery({
		queryKey: [...governanceReadsKey, contracts],
		queryFn: () => fetchHandovers(contracts),
		staleTime: STALE_MS,
		refetchInterval: active ? REFRESH_MS : false,
	})
	return { handovers: data ?? { status: "checking" } }
}

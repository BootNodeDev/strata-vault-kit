import {
	type ContractRead,
	type OracleState,
	readContract,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { navOracle } from "../config/clients"
import { cycleReadsKey } from "./useCycleState"
import { navLatestKey } from "./useNavPrice"
import { PAUSE_REFRESH_MS } from "./useVaultPaused"

export type OracleStatus =
	"checking" | "valid" | "stale" | "paused" | "unreadable"

const oracleStateKey = ["oracle", "state"] as const
export const oracleWriteKeys = [
	oracleStateKey,
	cycleReadsKey,
	navLatestKey,
] as const

const STATUS_BY_TAG = {
	Valid: "valid",
	Stale: "stale",
	Paused: "paused",
} as const satisfies Record<OracleState["tag"], OracleStatus>

export function classifyOracle(read: ContractRead<OracleState>): OracleStatus {
	return read.kind === "value" ? STATUS_BY_TAG[read.value.tag] : "unreadable"
}

async function fetchOracleState(): Promise<OracleStatus> {
	const read = await readContract(async () => (await navOracle()).state())
	return classifyOracle(read)
}

export function useOracleState({ poll = false }: { poll?: boolean } = {}): {
	oracle: OracleStatus
} {
	const { data } = useQuery({
		queryKey: oracleStateKey,
		queryFn: fetchOracleState,
		staleTime: 30_000,
		refetchInterval: poll ? PAUSE_REFRESH_MS : false,
	})

	return { oracle: data ?? "checking" }
}

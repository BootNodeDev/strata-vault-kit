import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"

export type PauseState = "checking" | "open" | "paused" | "unreadable"

export function classifyPause(read: ContractRead<boolean>): PauseState {
	if (read.kind !== "value") return "unreadable"
	return read.value ? "paused" : "open"
}

async function fetchVaultPause(): Promise<PauseState> {
	const read = await readContract(async () => (await asyncVault()).paused())
	return classifyPause(read)
}

export function useVaultPaused(): { pause: PauseState } {
	const { data } = useQuery({
		queryKey: ["vault", "paused"],
		queryFn: fetchVaultPause,
		staleTime: 30_000,
	})

	return { pause: data ?? "checking" }
}

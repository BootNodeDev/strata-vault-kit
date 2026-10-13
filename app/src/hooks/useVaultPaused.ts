import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"

export type PauseState = "checking" | "open" | "paused" | "unreadable"

export const vaultPausedKey = ["vault", "paused"] as const
export const PAUSE_REFRESH_MS = 15_000

export function classifyPause(read: ContractRead<boolean>): PauseState {
	if (read.kind !== "value") return "unreadable"
	return read.value ? "paused" : "open"
}

async function fetchVaultPause(): Promise<PauseState> {
	const read = await readContract(async () => (await asyncVault()).paused())
	return classifyPause(read)
}

export function useVaultPaused({ poll = false }: { poll?: boolean } = {}): {
	pause: PauseState
} {
	const { data } = useQuery({
		queryKey: vaultPausedKey,
		queryFn: fetchVaultPause,
		staleTime: 30_000,
		refetchInterval: poll ? PAUSE_REFRESH_MS : false,
	})

	return { pause: data ?? "checking" }
}

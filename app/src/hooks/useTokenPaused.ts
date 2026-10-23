import { readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { shareToken } from "../config/clients"
import {
	classifyPause,
	PAUSE_REFRESH_MS,
	type PauseState,
} from "./useVaultPaused"

export const tokenPausedKey = ["token", "paused"] as const

async function fetchTokenPause(): Promise<PauseState> {
	const read = await readContract(async () => (await shareToken()).paused())
	return classifyPause(read)
}

export function useTokenPaused(): {
	pause: PauseState
} {
	const { data } = useQuery({
		queryKey: tokenPausedKey,
		queryFn: fetchTokenPause,
		staleTime: 30_000,
		refetchInterval: PAUSE_REFRESH_MS,
	})

	return { pause: data ?? "checking" }
}

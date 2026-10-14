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

export function useTokenPaused({ poll = false }: { poll?: boolean } = {}): {
	pause: PauseState
} {
	const { data } = useQuery({
		queryKey: tokenPausedKey,
		queryFn: fetchTokenPause,
		staleTime: 30_000,
		refetchInterval: poll ? PAUSE_REFRESH_MS : false,
	})

	return { pause: data ?? "checking" }
}

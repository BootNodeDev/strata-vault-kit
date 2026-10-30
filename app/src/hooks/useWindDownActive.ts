import { readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"

export const windDownActiveKey = ["vault", "wind-down-active"] as const

async function fetchWindDownActive(): Promise<boolean | null> {
	const read = await readContract(async () => (await asyncVault()).wind_down())
	if (read.kind !== "value") return null
	return read.value?.status.tag === "Active"
}

export function useWindDownActive(): { windingDown: boolean | null } {
	const { data } = useQuery({
		queryKey: windDownActiveKey,
		queryFn: fetchWindDownActive,
		staleTime: 30_000,
	})

	return { windingDown: data ?? null }
}

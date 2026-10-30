import { type Amount, readContract } from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"
import { useWallet } from "./useWallet"

export const windDownClaimableKey = ["vault", "wind-down-claimable"] as const

async function fetchClaimable(holder: string): Promise<Amount | null> {
	const read = await readContract(async () =>
		(await asyncVault()).wind_down_claimable({ holder }),
	)
	return read.kind === "value" ? (read.value as Amount) : null
}

export function useWindDownClaimable(): { claimable: Amount | null } {
	const { address } = useWallet()
	const { data } = useQuery({
		queryKey: [...windDownClaimableKey, address],
		queryFn: address === undefined ? skipToken : () => fetchClaimable(address),
		staleTime: 30_000,
	})

	return { claimable: data ?? null }
}

import { readContract } from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { shareToken } from "../config/clients"
import { useWallet } from "./useWallet"

export const holderFrozenKey = (address: string | undefined) =>
	["token", "frozen", address] as const

async function fetchFrozen(address: string): Promise<boolean | null> {
	const read = await readContract(async () =>
		(await shareToken()).is_frozen({ user_address: address }),
	)
	return read.kind === "value" ? read.value : null
}

export function useHolderFrozen(): { frozen: boolean | null } {
	const { address } = useWallet()
	const { data } = useQuery({
		queryKey: holderFrozenKey(address),
		queryFn: address === undefined ? skipToken : () => fetchFrozen(address),
		staleTime: 30_000,
	})

	return { frozen: data ?? null }
}

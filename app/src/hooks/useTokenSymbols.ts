import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asset, shareToken } from "../config/clients"

export type TokenSymbols = {
	token: string
	shareToken: string
}

const FALLBACK: TokenSymbols = { token: "TOKEN", shareToken: "vTOKEN" }

export function toSymbols(
	token: ContractRead<string>,
	share: ContractRead<string>,
): TokenSymbols {
	return {
		token: token.kind === "value" ? token.value : FALLBACK.token,
		shareToken: share.kind === "value" ? share.value : FALLBACK.shareToken,
	}
}

async function fetchTokenSymbols(): Promise<TokenSymbols> {
	const [token, share] = await Promise.all([
		readContract(async () => (await asset()).symbol()),
		readContract(async () => (await shareToken()).symbol()),
	])
	return toSymbols(token, share)
}

export function useTokenSymbols(): { symbols: TokenSymbols } {
	const { data } = useQuery({
		queryKey: ["token", "symbols"],
		queryFn: fetchTokenSymbols,
		staleTime: 30_000,
	})

	return { symbols: data ?? FALLBACK }
}

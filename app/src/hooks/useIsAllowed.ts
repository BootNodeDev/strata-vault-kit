import {
	type ContractRead,
	type IdentityVerifierApi,
	readContract,
} from "@stellar-scaffold/app-lib"
import { queryOptions, skipToken, useQuery } from "@tanstack/react-query"
import { identityVerifierAt, shareToken } from "../config/clients"
import { useWallet } from "./useWallet"

export const isAllowedKey = ["identity", "is-allowed"] as const

export type Allowance = "checking" | "allowed" | "not-allowed" | "unreadable"

export function classifyAllowance(read: ContractRead<boolean>): Allowance {
	if (read.kind !== "value") return "unreadable"
	return read.value ? "allowed" : "not-allowed"
}

export async function fetchAllowance(
	verifier: Promise<IdentityVerifierApi>,
	account: string,
): Promise<Allowance> {
	const read = await readContract(async () =>
		(await verifier).is_allowed({ account }),
	)
	return classifyAllowance(read)
}

export const allowanceQuery = (
	verifier: string | null,
	account: string | undefined,
) =>
	queryOptions({
		queryKey: [...isAllowedKey, verifier, account] as const,
		queryFn:
			verifier === null || account === undefined
				? skipToken
				: () => fetchAllowance(identityVerifierAt(verifier), account),
		staleTime: 30_000,
	})

export const identityVerifierQuery = queryOptions({
	queryKey: [...isAllowedKey, "verifier"] as const,
	queryFn: async () => {
		const read = await readContract(async () =>
			(await shareToken()).identity_verifier(),
		)
		if (read.kind !== "value") {
			throw new Error(`share token identity_verifier read failed: ${read.kind}`)
		}
		return read.value
	},
	staleTime: 30_000,
})

export function useIsAllowed(): { allowance: Allowance } {
	const { address } = useWallet()
	const { data: verifier, isError } = useQuery(identityVerifierQuery)
	const { data } = useQuery(allowanceQuery(verifier ?? null, address))

	if (isError) return { allowance: "unreadable" }
	return { allowance: data ?? "checking" }
}

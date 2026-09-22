import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { identityVerifier } from "../config/clients"
import { useWallet } from "./useWallet"

export type Allowance = "checking" | "allowed" | "not-allowed" | "unreadable"

export function classifyAllowance(read: ContractRead<boolean>): Allowance {
	if (read.kind !== "value") return "unreadable"
	return read.value ? "allowed" : "not-allowed"
}

async function fetchAllowance(account: string): Promise<Allowance> {
	const read = await readContract(async () =>
		(await identityVerifier()).is_allowed({ account }),
	)
	return classifyAllowance(read)
}

export function useIsAllowed(): { allowance: Allowance } {
	const { address } = useWallet()
	const { data } = useQuery({
		queryKey: ["identity", "is-allowed", address],
		queryFn: address === undefined ? skipToken : () => fetchAllowance(address),
		staleTime: 30_000,
	})

	return { allowance: data ?? "checking" }
}

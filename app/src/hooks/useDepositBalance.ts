import {
	type Amount,
	type ContractRead,
	readContract,
} from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { asset } from "../config/clients"
import { useWallet } from "./useWallet"

export type DepositBalance =
	| { status: "disconnected" }
	| { status: "checking" }
	| { status: "unreadable" }
	| { status: "held"; amount: Amount }

export function classifyDepositBalance(
	read: ContractRead<bigint>,
): DepositBalance {
	if (read.kind !== "value") return { status: "unreadable" }
	return { status: "held", amount: read.value as Amount }
}

async function fetchDepositBalance(id: string): Promise<DepositBalance> {
	const read = await readContract(async () => (await asset()).balance({ id }))
	return classifyDepositBalance(read)
}

export function useDepositBalance(): { balance: DepositBalance } {
	const { address } = useWallet()
	const { data } = useQuery({
		queryKey: ["deposit", "balance", address],
		queryFn:
			address === undefined ? skipToken : () => fetchDepositBalance(address),
		staleTime: 30_000,
	})

	if (address === undefined) return { balance: { status: "disconnected" } }
	return { balance: data ?? { status: "checking" } }
}

import {
	type Amount,
	type ContractRead,
	readContract,
} from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { shareToken } from "../config/clients"
import { useWallet } from "./useWallet"

export type SharePosition =
	| { status: "disconnected" }
	| { status: "checking" }
	| { status: "unreadable" }
	| { status: "held"; shares: Amount }

export function classifyShares(read: ContractRead<bigint>): SharePosition {
	if (read.kind !== "value") return { status: "unreadable" }
	return { status: "held", shares: read.value as Amount }
}

async function fetchSharePosition(account: string): Promise<SharePosition> {
	const read = await readContract(async () =>
		(await shareToken()).balance({ account }),
	)
	return classifyShares(read)
}

export function useSharePosition(): { position: SharePosition } {
	const { address } = useWallet()
	const { data } = useQuery({
		queryKey: ["share", "balance", address],
		queryFn:
			address === undefined ? skipToken : () => fetchSharePosition(address),
		staleTime: 30_000,
	})

	if (address === undefined) return { position: { status: "disconnected" } }
	return { position: data ?? { status: "checking" } }
}

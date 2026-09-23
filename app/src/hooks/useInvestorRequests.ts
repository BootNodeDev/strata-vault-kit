import {
	type Amount,
	type ContractRead,
	type DepositRequest,
	type EpochInfo,
	type EpochStatus,
	type Price,
	type RedeemRequest,
	readContract,
} from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"
import { useWallet } from "./useWallet"

const FIRST_EPOCH = 1n

export type RequestSide = "deposit" | "redeem"

export type InvestorRequest = {
	epochId: bigint
	side: RequestSide
	epochStatus: EpochStatus
	sharePrice: Price
	amount: Amount
	claimed: boolean
}

export type ArchivedRequest = {
	epochId: bigint
	side: RequestSide
	epochStatus: EpochStatus
	sharePrice: Price
}

export type UnreadableRequest = {
	epochId: bigint
	side: RequestSide
}

export type ClassifiedRequest =
	| { kind: "absent" }
	| { kind: "unreadable"; request: UnreadableRequest }
	| { kind: "present"; request: InvestorRequest }
	| { kind: "archived"; request: ArchivedRequest }

export function classifyRequest(
	read: ContractRead<DepositRequest | RedeemRequest | undefined>,
	side: RequestSide,
	epochId: bigint,
	epoch: EpochInfo,
): ClassifiedRequest {
	if (read.kind === "archived") {
		return {
			kind: "archived",
			request: {
				epochId,
				side,
				epochStatus: epoch.status,
				sharePrice: epoch.share_price as Price,
			},
		}
	}
	if (read.kind !== "value")
		return { kind: "unreadable", request: { epochId, side } }
	if (read.value === undefined) return { kind: "absent" }

	const amount = "amount" in read.value ? read.value.amount : read.value.shares

	return {
		kind: "present",
		request: {
			epochId,
			side,
			epochStatus: epoch.status,
			sharePrice: epoch.share_price as Price,
			amount: amount as Amount,
			claimed: read.value.claimed,
		},
	}
}

export type InvestorRequestsRead =
	| { status: "disconnected" }
	| { status: "checking" }
	| { status: "unreadable" }
	| {
			status: "loaded"
			requests: InvestorRequest[]
			archived: ArchivedRequest[]
			unreadable: UnreadableRequest[]
	  }

export async function fetchInvestorRequests(
	controller: string,
): Promise<InvestorRequestsRead> {
	const vault = await asyncVault()
	const currentEpoch = await readContract(() => vault.current_epoch())
	if (currentEpoch.kind !== "value") return { status: "unreadable" }

	const requests: InvestorRequest[] = []
	const archived: ArchivedRequest[] = []
	const unreadable: UnreadableRequest[] = []
	for (let epochId = FIRST_EPOCH; epochId <= currentEpoch.value; epochId++) {
		const [epochRead, depositRead, redeemRead] = await Promise.all([
			readContract(() => vault.get_epoch({ epoch_id: epochId })),
			readContract(() =>
				vault.get_deposit_request({ epoch_id: epochId, controller }),
			),
			readContract(() =>
				vault.get_redeem_request({ epoch_id: epochId, controller }),
			),
		])

		if (epochRead.kind !== "value") {
			unreadable.push({ epochId, side: "deposit" })
			unreadable.push({ epochId, side: "redeem" })
			continue
		}
		if (epochRead.value === undefined) {
			console.error(
				`epoch ${epochId} has no get_epoch entry though current_epoch() reports ${currentEpoch.value}`,
			)
			unreadable.push({ epochId, side: "deposit" })
			unreadable.push({ epochId, side: "redeem" })
			continue
		}
		const epoch = epochRead.value

		const deposit = classifyRequest(depositRead, "deposit", epochId, epoch)
		const redeem = classifyRequest(redeemRead, "redeem", epochId, epoch)
		for (const classified of [deposit, redeem]) {
			if (classified.kind === "present") requests.push(classified.request)
			else if (classified.kind === "archived") archived.push(classified.request)
			else if (classified.kind === "unreadable")
				unreadable.push(classified.request)
		}
	}

	return { status: "loaded", requests, archived, unreadable }
}

export function useInvestorRequests(): { requests: InvestorRequestsRead } {
	const { address } = useWallet()
	const { data, isError } = useQuery({
		queryKey: ["investor", "requests", address],
		queryFn:
			address === undefined ? skipToken : () => fetchInvestorRequests(address),
		staleTime: 30_000,
	})

	if (address === undefined) return { requests: { status: "disconnected" } }
	if (data !== undefined) return { requests: data }
	if (isError) return { requests: { status: "unreadable" } }
	return { requests: { status: "checking" } }
}

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

		if (epochRead.kind !== "value" || epochRead.value === undefined) {
			unreadable.push({ epochId, side: "deposit" })
			unreadable.push({ epochId, side: "redeem" })
			continue
		}
		const epoch = epochRead.value

		const deposit = classifyRequest(depositRead, "deposit", epochId, epoch)
		if (deposit.kind === "present") requests.push(deposit.request)
		if (deposit.kind === "archived") archived.push(deposit.request)
		if (deposit.kind === "unreadable") unreadable.push(deposit.request)

		const redeem = classifyRequest(redeemRead, "redeem", epochId, epoch)
		if (redeem.kind === "present") requests.push(redeem.request)
		if (redeem.kind === "archived") archived.push(redeem.request)
		if (redeem.kind === "unreadable") unreadable.push(redeem.request)
	}

	return { status: "loaded", requests, archived, unreadable }
}

export function useInvestorRequests(): { requests: InvestorRequestsRead } {
	const { address } = useWallet()
	const { data } = useQuery({
		queryKey: ["investor", "requests", address],
		queryFn:
			address === undefined ? skipToken : () => fetchInvestorRequests(address),
		staleTime: 30_000,
	})

	if (address === undefined) return { requests: { status: "disconnected" } }
	return { requests: data ?? { status: "checking" } }
}

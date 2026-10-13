import {
	type Amount,
	type EpochStatus,
	type Price,
	readContract,
	readEpochs,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { addresses } from "../config/addresses"
import { asyncVault } from "../config/clients"

const FIRST_EPOCH = 1n

export type EpochRecord = {
	id: bigint
	status: EpochStatus["tag"]
	totalDeposited: Amount
	totalSharesRedeeming: Amount
	sharePrice: Price | null
	closedAt: bigint
	priceableAt: bigint
}

export type EpochHistoryRead =
	| { status: "checking" }
	| { status: "unreadable" }
	| {
			status: "loaded"
			currentEpoch: bigint
			epochs: EpochRecord[]
			absent: bigint[]
			unreadable: bigint[]
	  }

export const epochHistoryKey = ["cycle", "history"] as const

export async function fetchEpochHistory(): Promise<EpochHistoryRead> {
	const currentEpoch = await readContract(async () =>
		(await asyncVault()).current_epoch(),
	)
	if (currentEpoch.kind !== "value") return { status: "unreadable" }

	const epochIds: bigint[] = []
	for (let epochId = FIRST_EPOCH; epochId <= currentEpoch.value; epochId++)
		epochIds.push(epochId)

	const reads = await readEpochs(addresses.async_vault, epochIds)

	const epochs: EpochRecord[] = []
	const absent: bigint[] = []
	const unreadable: bigint[] = []
	for (const id of epochIds) {
		const read = reads.get(id)
		if (read?.kind === "archived") {
			absent.push(id)
		} else if (read?.kind !== "value" || read.value === null) {
			unreadable.push(id)
		} else {
			const epoch = read.value
			epochs.push({
				id,
				status: epoch.status.tag,
				totalDeposited: epoch.total_deposited as Amount,
				totalSharesRedeeming: epoch.total_shares_redeeming as Amount,
				sharePrice:
					epoch.status.tag === "Fulfilled"
						? (epoch.share_price as Price)
						: null,
				closedAt: epoch.closed_at,
				priceableAt: epoch.priceable_at,
			})
		}
	}

	return {
		status: "loaded",
		currentEpoch: currentEpoch.value,
		epochs: epochs.reverse(),
		absent,
		unreadable,
	}
}

export function useEpochHistory(): { history: EpochHistoryRead } {
	const { data } = useQuery({
		queryKey: epochHistoryKey,
		queryFn: fetchEpochHistory,
		staleTime: 30_000,
	})

	return { history: data ?? { status: "checking" } }
}

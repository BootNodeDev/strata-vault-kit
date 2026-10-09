import { type Price, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"

export type FulfillEpochStatus = TransactionStatus<{ sharePrice: Price }>

export interface UseFulfillEpoch {
	status: FulfillEpochStatus
	submit: (epochId: bigint) => boolean
	reset: () => void
}

export function useFulfillEpoch(): UseFulfillEpoch {
	const call = useCallback(
		(signer: Signer, epochId: bigint) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.fulfill_epoch({ epoch_id: epochId }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(sharePrice: bigint) => ({ sharePrice: sharePrice as Price }),
		[],
	)
	return useContractTransaction(call, toConfirmed, cycleWriteKeys)
}

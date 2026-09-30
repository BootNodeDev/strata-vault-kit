import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"

export type CancelRedeemStatus = TransactionStatus<{ returnedShares: Amount }>

export interface UseCancelRedeem {
	status: CancelRedeemStatus
	submit: (epochId: bigint) => boolean
	reset: () => void
}

export function useCancelRedeem(): UseCancelRedeem {
	const call = useCallback(
		(signer: Signer, epochId: bigint) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.cancel_redeem({ from: signer.publicKey, epoch_id: epochId }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(returnedShares: bigint) => ({ returnedShares: returnedShares as Amount }),
		[],
	)
	return useContractTransaction(call, toConfirmed)
}

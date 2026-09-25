import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"

export type CancelDepositStatus = TransactionStatus<{ refundedAmount: Amount }>

export interface UseCancelDeposit {
	status: CancelDepositStatus
	submit: (epochId: bigint) => Promise<void>
	reset: () => void
}

export function useCancelDeposit(): UseCancelDeposit {
	const call = useCallback(
		(signer: Signer, epochId: bigint) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.cancel_deposit({ from: signer.publicKey, epoch_id: epochId }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(refundedAmount: bigint) => ({ refundedAmount: refundedAmount as Amount }),
		[],
	)
	return useContractTransaction(call, toConfirmed)
}

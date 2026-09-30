import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"

export type ClaimDepositStatus = TransactionStatus<{ sharesMinted: Amount }>

export interface UseClaimDeposit {
	status: ClaimDepositStatus
	submit: (epochId: bigint) => boolean
	reset: () => void
}

export function useClaimDeposit(): UseClaimDeposit {
	const call = useCallback(
		(signer: Signer, epochId: bigint) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.claim_deposit({ caller: signer.publicKey, epoch_id: epochId }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(sharesMinted: bigint) => ({ sharesMinted: sharesMinted as Amount }),
		[],
	)
	return useContractTransaction(call, toConfirmed)
}

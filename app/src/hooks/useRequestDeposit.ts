import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"

export type RequestDepositStatus = TransactionStatus<{ epochId: bigint }>

export interface UseRequestDeposit {
	status: RequestDepositStatus
	submit: (amount: Amount) => Promise<boolean>
	reset: () => void
}

export function useRequestDeposit(): UseRequestDeposit {
	const call = useCallback(
		(signer: Signer, amount: Amount) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.request_deposit({ from: signer.publicKey, amount }),
			),
		[],
	)
	const toConfirmed = useCallback((epochId: bigint) => ({ epochId }), [])
	return useContractTransaction(call, toConfirmed)
}

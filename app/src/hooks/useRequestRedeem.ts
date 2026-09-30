import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"

export type RequestRedeemStatus = TransactionStatus<{ epochId: bigint }>

export interface UseRequestRedeem {
	status: RequestRedeemStatus
	submit: (shares: Amount) => boolean
	reset: () => void
}

export function useRequestRedeem(): UseRequestRedeem {
	const call = useCallback(
		(signer: Signer, shares: Amount) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.request_redeem({ from: signer.publicKey, shares }),
			),
		[],
	)
	const toConfirmed = useCallback((epochId: bigint) => ({ epochId }), [])
	return useContractTransaction(call, toConfirmed)
}

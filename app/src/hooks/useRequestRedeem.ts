import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	type Release,
	type TransactionStatus,
	useContractTransaction,
} from "./useContractTransaction"

export type RequestRedeemStatus = TransactionStatus

export interface UseRequestRedeem {
	status: RequestRedeemStatus
	submit: (shares: Amount) => boolean
	prepare: (shares: Amount) => Release
	reset: () => void
}

export function useRequestRedeem(): UseRequestRedeem {
	const call = useCallback(
		(signer: Signer, shares: Amount) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.request_redeem({ holder: signer.publicKey, shares }),
			),
		[],
	)
	const toConfirmed = useCallback(() => ({}), [])
	return useContractTransaction(call, toConfirmed)
}

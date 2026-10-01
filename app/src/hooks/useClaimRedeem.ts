import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"

export type ClaimRedeemStatus = TransactionStatus<{ assetsClaimed: Amount }>

export interface UseClaimRedeem {
	status: ClaimRedeemStatus
	submit: (epochId: bigint) => boolean
	reset: () => void
}

export function useClaimRedeem(): UseClaimRedeem {
	const call = useCallback(
		(signer: Signer, epochId: bigint) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.claim_redeem({ caller: signer.publicKey, epoch_id: epochId }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(assetsClaimed: bigint) => ({ assetsClaimed: assetsClaimed as Amount }),
		[],
	)
	return useContractTransaction(call, toConfirmed)
}

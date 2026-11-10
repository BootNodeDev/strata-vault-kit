import {
	type Amount,
	type Signer,
	type TransactionEvent,
} from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	type Release,
	type TransactionStatus,
	useContractTransaction,
} from "./useContractTransaction"

export type ClaimRedeemStatus = TransactionStatus<{
	assetsClaimed: Amount
	sharesReturned: boolean
}>

export interface UseClaimRedeem {
	status: ClaimRedeemStatus
	submit: (epochId: bigint) => boolean
	prepare: (epochId: bigint) => Release
	reset: () => void
}

export function useClaimRedeem(): UseClaimRedeem {
	const call = useCallback(
		(signer: Signer, epochId: bigint) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.claim_redeem({ holder: signer.publicKey, epoch_id: epochId }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(assetsClaimed: bigint, events: TransactionEvent[]) => ({
			assetsClaimed: assetsClaimed as Amount,
			sharesReturned: events.some((event) => event.name === "redeem_cancelled"),
		}),
		[],
	)
	return useContractTransaction(call, toConfirmed)
}

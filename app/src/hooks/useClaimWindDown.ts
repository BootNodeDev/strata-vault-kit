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
import { windDownClaimableKey } from "./useWindDownClaimable"

export type ClaimWindDownStatus = TransactionStatus<{
	assetsClaimed: Amount
	sharesSurrendered: Amount
}>

export interface UseClaimWindDown {
	status: ClaimWindDownStatus
	submit: (arg: undefined) => boolean
	prepare: (arg: undefined) => Release
	reset: () => void
}

const EXTRA_KEYS = [windDownClaimableKey]

const surrenderedOf = (events: TransactionEvent[]): bigint => {
	const claimed = events.find((event) => event.name === "wind_down_claimed")
	const data = claimed?.data as { surrendered?: unknown } | undefined
	return typeof data?.surrendered === "bigint" ? data.surrendered : 0n
}

export function useClaimWindDown(): UseClaimWindDown {
	const call = useCallback(
		(signer: Signer) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.claim_wind_down({ holder: signer.publicKey }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(assetsClaimed: bigint, events: TransactionEvent[]) => ({
			assetsClaimed: assetsClaimed as Amount,
			sharesSurrendered: surrenderedOf(events) as Amount,
		}),
		[],
	)
	return useContractTransaction(call, toConfirmed, EXTRA_KEYS)
}

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

export type ClaimDepositOutcome = { sharesMinted: Amount; queuedInto?: bigint }

export type ClaimDepositStatus = TransactionStatus<ClaimDepositOutcome>

const queuedIntoOf = (events: TransactionEvent[]): bigint | undefined => {
	const converted = events.find(
		(event) => event.name === "deposit_converted_to_exit",
	)
	const data = converted?.data as { into_epoch?: unknown } | undefined
	return typeof data?.into_epoch === "bigint" ? data.into_epoch : undefined
}

export interface UseClaimDeposit {
	status: ClaimDepositStatus
	submit: (epochId: bigint) => boolean
	prepare: (epochId: bigint) => Release
	reset: () => void
}

export function useClaimDeposit(): UseClaimDeposit {
	const call = useCallback(
		(signer: Signer, epochId: bigint) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.claim_deposit({ holder: signer.publicKey, epoch_id: epochId }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(sharesMinted: bigint, events: TransactionEvent[]): ClaimDepositOutcome => {
			const queuedInto = queuedIntoOf(events)
			const outcome = { sharesMinted: sharesMinted as Amount }
			return queuedInto === undefined ? outcome : { ...outcome, queuedInto }
		},
		[],
	)
	return useContractTransaction(call, toConfirmed)
}

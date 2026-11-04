import { Buffer } from "buffer"
import {
	type Price,
	readLedgerTime,
	type Signer,
} from "@stellar-scaffold/app-lib"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { navOracleWriter } from "../config/clients"
import {
	type Release,
	type TransactionStatus,
	useContractTransaction,
} from "./useContractTransaction"
import { type CycleReads, cycleReadsKey, cycleWriteKeys } from "./useCycleState"
import { navLatestKey } from "./useNavPrice"

export type AttestStatus = TransactionStatus

export type Attestation = {
	price: Price
	freshness: bigint
	proofHash: string
	proofUri: string
}

export const attestWriteKeys = [...cycleWriteKeys, navLatestKey] as const

export interface UseAttest {
	status: AttestStatus
	submit: (attestation: Attestation) => boolean
	prepare: (attestation: Attestation) => Release
	reset: () => void
}

export function useAttest(): UseAttest {
	const queryClient = useQueryClient()
	const call = useCallback(
		async (
			signer: Signer,
			{ price, freshness, proofHash, proofUri }: Attestation,
		) => {
			const cached = queryClient.getQueryState<CycleReads>(cycleReadsKey)
			const cachedLedgerTime = cached?.data?.ledgerTime
			// The cycle read pauses while the tab is hidden, so age the cached value.
			const ledgerTime =
				cached && cachedLedgerTime != null
					? cachedLedgerTime +
						BigInt(
							Math.floor(Math.max(0, Date.now() - cached.dataUpdatedAt) / 1000),
						)
					: await readLedgerTime()
			const oracle = await navOracleWriter(signer)
			return oracle.attest({
				input: {
					nav_per_share: price,
					expires_at:
						(ledgerTime ?? BigInt(Math.floor(Date.now() / 1000))) + freshness,
					proof_hash: Buffer.from(proofHash, "hex"),
					proof_uri: proofUri,
				},
				caller: signer.publicKey,
			})
		},
		[queryClient],
	)
	const toConfirmed = useCallback(() => ({}), [])
	return useContractTransaction<Attestation, void, Record<never, never>>(
		call,
		toConfirmed,
		attestWriteKeys,
	)
}

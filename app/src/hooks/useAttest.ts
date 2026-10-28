import { Buffer } from "buffer"
import { type Price, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { navOracleWriter } from "../config/clients"
import {
	type Release,
	type TransactionStatus,
	useContractTransaction,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"
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
	const call = useCallback(
		(signer: Signer, { price, freshness, proofHash, proofUri }: Attestation) =>
			navOracleWriter(signer).then((oracle) =>
				oracle.attest({
					input: {
						nav_per_share: price,
						expires_at: BigInt(Math.floor(Date.now() / 1000)) + freshness,
						proof_hash: Buffer.from(proofHash, "hex"),
						proof_uri: proofUri,
					},
					caller: signer.publicKey,
				}),
			),
		[],
	)
	const toConfirmed = useCallback(() => ({}), [])
	return useContractTransaction<Attestation, void, Record<never, never>>(
		call,
		toConfirmed,
		attestWriteKeys,
	)
}

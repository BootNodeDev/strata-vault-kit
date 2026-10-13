import { type Price, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { navOracleWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"

export type AttestStatus = TransactionStatus

export type Attestation = { price: Price; freshness: bigint }

export const attestWriteKeys = [...cycleWriteKeys, ["nav", "latest"]] as const

export interface UseAttest {
	status: AttestStatus
	submit: (attestation: Attestation) => boolean
	reset: () => void
}

export function useAttest(): UseAttest {
	const call = useCallback(
		(signer: Signer, { price, freshness }: Attestation) =>
			navOracleWriter(signer).then((oracle) =>
				oracle.attest({
					report: {
						nav_per_share: price,
						expires_at: BigInt(Math.floor(Date.now() / 1000)) + freshness,
						timestamp: 0n,
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

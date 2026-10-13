import { type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"

export type CloseEpochStatus = TransactionStatus<{ sealedEpoch: bigint }>

export interface UseCloseEpoch {
	status: CloseEpochStatus
	submit: () => boolean
	reset: () => void
}

export function useCloseEpoch(): UseCloseEpoch {
	const call = useCallback(
		(signer: Signer) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.close_epoch({ caller: signer.publicKey }),
			),
		[],
	)
	const toConfirmed = useCallback(
		(sealedEpoch: bigint) => ({ sealedEpoch }),
		[],
	)
	return useContractTransaction<void, bigint, { sealedEpoch: bigint }>(
		call,
		toConfirmed,
		cycleWriteKeys,
	)
}

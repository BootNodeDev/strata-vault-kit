import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"

export type FundStatus = TransactionStatus

export interface UseFund {
	status: FundStatus
	submit: (assets: Amount) => boolean
	reset: () => void
}

export function useFund(): UseFund {
	const call = useCallback(
		(signer: Signer, assets: Amount) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.fund({ from: signer.publicKey, assets }),
			),
		[],
	)
	const toConfirmed = useCallback(() => ({}), [])
	return useContractTransaction<Amount, bigint, Record<never, never>>(
		call,
		toConfirmed,
		cycleWriteKeys,
	)
}

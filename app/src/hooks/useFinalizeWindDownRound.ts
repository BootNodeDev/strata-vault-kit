import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"

export type FinalizeWindDownRoundStatus = TransactionStatus<{
	credited: Amount
}>

export interface UseFinalizeWindDownRound {
	status: FinalizeWindDownRoundStatus
	submit: () => boolean
	reset: () => void
}

export function useFinalizeWindDownRound(): UseFinalizeWindDownRound {
	const call = useCallback(
		(signer: Signer) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.finalize_wind_down_round(),
			),
		[],
	)
	const toConfirmed = useCallback(
		(credited: bigint) => ({ credited: credited as Amount }),
		[],
	)
	return useContractTransaction<void, bigint, { credited: Amount }>(
		call,
		toConfirmed,
		cycleWriteKeys,
	)
}

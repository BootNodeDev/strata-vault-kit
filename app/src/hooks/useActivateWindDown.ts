import { type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"

export type ActivateWindDownStatus = TransactionStatus

export interface UseActivateWindDown {
	status: ActivateWindDownStatus
	submit: () => boolean
	reset: () => void
}

export function useActivateWindDown(): UseActivateWindDown {
	const call = useCallback(
		(signer: Signer) =>
			asyncVaultWriter(signer).then((vault) => vault.activate_wind_down()),
		[],
	)
	const toConfirmed = useCallback(() => ({}), [])
	return useContractTransaction<void, void, Record<never, never>>(
		call,
		toConfirmed,
		cycleWriteKeys,
	)
}

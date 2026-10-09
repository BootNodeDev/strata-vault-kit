import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"

export type DeployToCustodianStatus = TransactionStatus

export interface UseDeployToCustodian {
	status: DeployToCustodianStatus
	submit: (assets: Amount) => boolean
	reset: () => void
}

export function useDeployToCustodian(): UseDeployToCustodian {
	const call = useCallback(
		(signer: Signer, assets: Amount) =>
			asyncVaultWriter(signer).then((vault) =>
				vault.deploy_to_custodian({ caller: signer.publicKey, assets }),
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

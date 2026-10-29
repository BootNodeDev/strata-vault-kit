import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	type Release,
	type TransactionStatus,
	useContractTransaction,
} from "./useContractTransaction"
import { custodianBalanceKey, cycleWriteKeys } from "./useCycleState"

export type DeployToCustodianStatus = TransactionStatus

export interface UseDeployToCustodian {
	status: DeployToCustodianStatus
	submit: (assets: Amount) => boolean
	prepare: (assets: Amount) => Release
	reset: () => void
}

const refreshKeys = [...cycleWriteKeys, custodianBalanceKey]

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
		refreshKeys,
	)
}

import { type Amount, type Signer } from "@stellar-scaffold/app-lib"
import { useCallback, useMemo } from "react"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type TransactionStatus,
} from "./useContractTransaction"
import { custodianBalanceKey, cycleWriteKeys } from "./useCycleState"
import { depositBalanceKey } from "./useDepositBalance"
import { useWallet } from "./useWallet"

export type FundStatus = TransactionStatus

export interface UseFund {
	status: FundStatus
	submit: (assets: Amount) => boolean
	reset: () => void
}

export function useFund(): UseFund {
	const { address } = useWallet()
	const refreshKeys = useMemo(
		() =>
			address
				? [...cycleWriteKeys, custodianBalanceKey, depositBalanceKey(address)]
				: [...cycleWriteKeys, custodianBalanceKey],
		[address],
	)
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
		refreshKeys,
	)
}

import { useCallback, useRef, useState } from "react"
import { type Grant } from "./useAdminAuthority"
import {
	type TransactionStatus,
	type UseContractTransaction,
} from "./useContractTransaction"

export interface UsePendingTransaction<TArg, TConfirmed extends object> {
	status: TransactionStatus<TConfirmed>
	amountLabel: string
	submit: (arg: TArg, amountLabel: string, grant?: Grant) => boolean
	retry: () => void
	reset: () => void
}

export function usePendingTransaction<TArg, TConfirmed extends object>(
	transaction: UseContractTransaction<TArg, TConfirmed>,
): UsePendingTransaction<TArg, TConfirmed> {
	const { status, submit: submitTransaction, reset } = transaction
	const [amountLabel, setAmountLabel] = useState("")
	const pending = useRef<{ arg: TArg; grant: Grant | undefined } | null>(null)

	const submit = useCallback(
		(arg: TArg, label: string, grant?: Grant): boolean => {
			if (!submitTransaction(arg, grant)) return false
			pending.current = { arg, grant }
			setAmountLabel(label)
			return true
		},
		[submitTransaction],
	)

	const retry = useCallback(() => {
		if (pending.current === null) return
		submitTransaction(pending.current.arg, pending.current.grant)
	}, [submitTransaction])

	return { status, amountLabel, submit, retry, reset }
}

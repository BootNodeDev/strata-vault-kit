import { useCallback, useRef, useState } from "react"
import {
	type TransactionStatus,
	type UseContractTransaction,
} from "./useContractTransaction"

export interface UsePendingTransaction<TArg, TConfirmed extends object> {
	status: TransactionStatus<TConfirmed>
	amountLabel: string
	submit: (arg: TArg, amountLabel: string) => boolean
	retry: () => void
	reset: () => void
}

export function usePendingTransaction<TArg, TConfirmed extends object>(
	transaction: UseContractTransaction<TArg, TConfirmed>,
): UsePendingTransaction<TArg, TConfirmed> {
	const { status, submit: submitTransaction, reset } = transaction
	const [amountLabel, setAmountLabel] = useState("")
	const pendingArg = useRef<TArg | null>(null)

	const submit = useCallback(
		(arg: TArg, label: string): boolean => {
			if (!submitTransaction(arg)) return false
			pendingArg.current = arg
			setAmountLabel(label)
			return true
		},
		[submitTransaction],
	)

	const retry = useCallback(() => {
		if (pendingArg.current === null) return
		submitTransaction(pendingArg.current)
	}, [submitTransaction])

	return { status, amountLabel, submit, retry, reset }
}

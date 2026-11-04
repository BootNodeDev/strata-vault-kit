import { useCallback, useRef, useState } from "react"
import { type Grant } from "./useAdminAuthority"
import {
	type Release,
	type TransactionStatus,
	type UseContractTransaction,
} from "./useContractTransaction"

export interface UsePendingTransaction<TArg, TConfirmed extends object> {
	status: TransactionStatus<TConfirmed>
	amountLabel: string
	submit: (arg: TArg, amountLabel: string, grant?: Grant) => boolean
	prepare: (arg: TArg, grant?: Grant) => Release
	retry: () => void
	reset: () => void
}

export function usePendingTransaction<TArg, TConfirmed extends object>(
	transaction: UseContractTransaction<TArg, TConfirmed>,
): UsePendingTransaction<TArg, TConfirmed> {
	const { status, submit: submitTransaction, prepare, reset } = transaction
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

	return { status, amountLabel, submit, prepare, retry, reset }
}

export type Sendable<TArg> = Pick<
	UsePendingTransaction<TArg, object>,
	"submit" | "prepare"
>

export type Send = <TArg>(
	flow: Sendable<TArg>,
	arg: TArg,
	amountLabel: string,
	grant?: Grant,
) => Release | undefined

export const submitTo: Send = (flow, arg, amountLabel, grant) => {
	flow.submit(arg, amountLabel, grant)
	return undefined
}

export const prepareFor: Send = (flow, arg, _amountLabel, grant) =>
	flow.prepare(arg, grant)

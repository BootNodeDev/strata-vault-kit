import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import {
	type Signer,
	isUserRejection,
	parseErrorCode,
} from "@stellar-scaffold/app-lib"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"
import { depositBalanceKey } from "./useDepositBalance"
import { investorRequestsKey } from "./useInvestorRequests"
import { useWallet } from "./useWallet"

export type TransactionFailure =
	| { kind: "declined" }
	| { kind: "contract-error"; code: number }
	| { kind: "interrupted" }
	| { kind: "unknown" }

export type TransactionStatus<TConfirmed extends object> =
	| { status: "idle" }
	| { status: "preparing" }
	| { status: "awaiting-signature" }
	| { status: "submitted"; hash?: string }
	| ({ status: "confirmed"; hash?: string } & TConfirmed)
	| { status: "failed"; failure: TransactionFailure; hash?: string }

export interface UseContractTransaction<TArg, TConfirmed extends object> {
	status: TransactionStatus<TConfirmed>
	submit: (arg: TArg) => Promise<void>
	reset: () => void
}

export function useContractTransaction<
	TArg,
	TResult,
	TConfirmed extends object,
>(
	call: (signer: Signer, arg: TArg) => Promise<AssembledTransaction<TResult>>,
	toConfirmed: (result: TResult) => TConfirmed,
): UseContractTransaction<TArg, TConfirmed> {
	const { address, signTransaction } = useWallet()
	const queryClient = useQueryClient()
	const [status, setStatus] = useState<TransactionStatus<TConfirmed>>({
		status: "idle",
	})
	const submitting = useRef(false)
	const inFlightArg = useRef<TArg | undefined>(undefined)
	const dismissed = useRef(false)
	const lastStatus = useRef<TransactionStatus<TConfirmed>>({ status: "idle" })

	const submit = useCallback(
		async (arg: TArg) => {
			if (address === undefined) return
			if (submitting.current && inFlightArg.current === arg) {
				dismissed.current = false
				setStatus(lastStatus.current)
				return
			}
			submitting.current = true
			inFlightArg.current = arg
			dismissed.current = false
			let hash: string | undefined
			let signatureRequested = false
			let reachedNetwork = false
			const applyStatus = (next: TransactionStatus<TConfirmed>) => {
				if (inFlightArg.current !== arg) return
				lastStatus.current = next
				if (!dismissed.current) setStatus(next)
			}
			const invalidateRequestData = (owner: string) => {
				void queryClient.invalidateQueries({
					queryKey: investorRequestsKey(owner),
				})
				void queryClient.invalidateQueries({
					queryKey: depositBalanceKey(owner),
				})
			}
			applyStatus({ status: "preparing" })
			try {
				const tx = await call({ publicKey: address, signTransaction }, arg)
				const code = parseErrorCode(tx.simulation)
				if (code !== null) {
					applyStatus({
						status: "failed",
						failure: { kind: "contract-error", code },
					})
					return
				}
				signatureRequested = true
				applyStatus({ status: "awaiting-signature" })
				const sent = await tx.signAndSend({
					watcher: {
						onSubmitted: (response) => {
							hash = response?.hash
							reachedNetwork = true
							applyStatus({ status: "submitted", hash })
						},
						onProgress: () => {},
					},
				})
				if (sent.getTransactionResponse?.status !== "SUCCESS") {
					applyStatus({ status: "failed", failure: { kind: "unknown" }, hash })
					invalidateRequestData(address)
					return
				}
				applyStatus({
					status: "confirmed",
					...toConfirmed(sent.result),
					hash,
				} as TransactionStatus<TConfirmed>)
				invalidateRequestData(address)
			} catch (error) {
				applyStatus({
					status: "failed",
					failure: isUserRejection(error)
						? { kind: "declined" }
						: signatureRequested
							? { kind: "unknown" }
							: { kind: "interrupted" },
					hash,
				})
				if (reachedNetwork) invalidateRequestData(address)
			} finally {
				if (inFlightArg.current === arg) submitting.current = false
			}
		},
		[address, signTransaction, call, toConfirmed, queryClient],
	)

	const reset = useCallback(() => {
		dismissed.current = true
		setStatus({ status: "idle" })
	}, [])

	return { status, submit, reset }
}

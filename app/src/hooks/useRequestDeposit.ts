import {
	type Amount,
	isUserRejection,
	parseErrorCode,
} from "@stellar-scaffold/app-lib"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"
import { asyncVaultWriter } from "../config/clients"
import { depositBalanceKey } from "./useDepositBalance"
import { investorRequestsKey } from "./useInvestorRequests"
import { useWallet } from "./useWallet"

export type RequestDepositFailure =
	| { kind: "declined" }
	| { kind: "contract-error"; code: number }
	| { kind: "interrupted" }
	| { kind: "unknown" }

export type RequestDepositStatus =
	| { status: "idle" }
	| { status: "awaiting-signature" }
	| { status: "submitted"; hash?: string }
	| { status: "confirmed"; epochId: bigint; hash?: string }
	| { status: "failed"; failure: RequestDepositFailure; hash?: string }

export interface UseRequestDeposit {
	status: RequestDepositStatus
	submit: (amount: Amount) => Promise<void>
	reset: () => void
}

export function useRequestDeposit(): UseRequestDeposit {
	const { address, signTransaction } = useWallet()
	const queryClient = useQueryClient()
	const [status, setStatus] = useState<RequestDepositStatus>({ status: "idle" })
	const submitting = useRef(false)
	const dismissed = useRef(false)
	const lastStatus = useRef<RequestDepositStatus>({ status: "idle" })

	const submit = useCallback(
		async (amount: Amount) => {
			if (address === undefined) return
			if (submitting.current) {
				dismissed.current = false
				setStatus(lastStatus.current)
				return
			}
			submitting.current = true
			dismissed.current = false
			lastStatus.current = { status: "idle" }
			let hash: string | undefined
			let signatureRequested = false
			const applyStatus = (next: RequestDepositStatus) => {
				lastStatus.current = next
				if (!dismissed.current) setStatus(next)
			}
			try {
				const vault = await asyncVaultWriter({
					publicKey: address,
					signTransaction,
				})
				const tx = await vault.request_deposit({ from: address, amount })
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
							applyStatus({ status: "submitted", hash })
						},
						onProgress: () => {},
					},
				})
				if (sent.getTransactionResponse?.status !== "SUCCESS") {
					applyStatus({ status: "failed", failure: { kind: "unknown" }, hash })
					return
				}
				applyStatus({ status: "confirmed", epochId: sent.result, hash })
				void queryClient.invalidateQueries({
					queryKey: investorRequestsKey(address),
				})
				void queryClient.invalidateQueries({
					queryKey: depositBalanceKey(address),
				})
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
			} finally {
				submitting.current = false
			}
		},
		[address, signTransaction, queryClient],
	)

	const reset = useCallback(() => {
		dismissed.current = true
		setStatus({ status: "idle" })
	}, [])

	return { status, submit, reset }
}

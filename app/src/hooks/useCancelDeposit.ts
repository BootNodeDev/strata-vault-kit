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

export type CancelDepositFailure =
	| { kind: "declined" }
	| { kind: "contract-error"; code: number }
	| { kind: "interrupted" }
	| { kind: "unknown" }

export type CancelDepositStatus =
	| { status: "idle" }
	| { status: "preparing" }
	| { status: "awaiting-signature" }
	| { status: "submitted"; hash?: string }
	| { status: "confirmed"; refundedAmount: Amount; hash?: string }
	| { status: "failed"; failure: CancelDepositFailure; hash?: string }

export interface UseCancelDeposit {
	status: CancelDepositStatus
	submit: (epochId: bigint) => Promise<void>
	reset: () => void
}

export function useCancelDeposit(): UseCancelDeposit {
	const { address, signTransaction } = useWallet()
	const queryClient = useQueryClient()
	const [status, setStatus] = useState<CancelDepositStatus>({ status: "idle" })
	const submitting = useRef(false)
	const dismissed = useRef(false)
	const lastStatus = useRef<CancelDepositStatus>({ status: "idle" })

	const submit = useCallback(
		async (epochId: bigint) => {
			if (address === undefined) return
			if (submitting.current) {
				dismissed.current = false
				setStatus(lastStatus.current)
				return
			}
			submitting.current = true
			dismissed.current = false
			let hash: string | undefined
			let signatureRequested = false
			let reachedNetwork = false
			const applyStatus = (next: CancelDepositStatus) => {
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
				const vault = await asyncVaultWriter({
					publicKey: address,
					signTransaction,
				})
				const tx = await vault.cancel_deposit({
					from: address,
					epoch_id: epochId,
				})
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
					refundedAmount: sent.result as Amount,
					hash,
				})
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

import {
	type Amount,
	isUserRejection,
	parseErrorCode,
} from "@stellar-scaffold/app-lib"
import { useCallback, useRef, useState } from "react"
import { asyncVaultWriter } from "../config/clients"
import { useWallet } from "./useWallet"

export type RequestDepositFailure =
	| { kind: "declined" }
	| { kind: "contract-error"; code: number }
	| { kind: "unknown" }

export type RequestDepositStatus =
	| { status: "idle" }
	| { status: "awaiting-signature" }
	| { status: "submitted" }
	| { status: "confirmed"; epochId: bigint }
	| { status: "failed"; failure: RequestDepositFailure }

export interface UseRequestDeposit {
	status: RequestDepositStatus
	submit: (amount: Amount) => Promise<void>
	reset: () => void
}

export function useRequestDeposit(): UseRequestDeposit {
	const { address, signTransaction } = useWallet()
	const [status, setStatus] = useState<RequestDepositStatus>({ status: "idle" })
	const submitting = useRef(false)

	const submit = useCallback(
		async (amount: Amount) => {
			if (submitting.current || address === undefined) return
			submitting.current = true
			try {
				const vault = await asyncVaultWriter({
					publicKey: address,
					signTransaction,
				})
				const tx = await vault.request_deposit({ from: address, amount })
				const code = parseErrorCode(tx.simulation)
				if (code !== null) {
					setStatus({
						status: "failed",
						failure: { kind: "contract-error", code },
					})
					return
				}
				setStatus({ status: "awaiting-signature" })
				const sent = await tx.signAndSend({
					watcher: {
						onSubmitted: () => setStatus({ status: "submitted" }),
						onProgress: () => {},
					},
				})
				if (sent.getTransactionResponse?.status !== "SUCCESS") {
					setStatus({ status: "failed", failure: { kind: "unknown" } })
					return
				}
				setStatus({ status: "confirmed", epochId: sent.result })
			} catch (error) {
				setStatus({
					status: "failed",
					failure: isUserRejection(error)
						? { kind: "declined" }
						: { kind: "unknown" },
				})
			} finally {
				submitting.current = false
			}
		},
		[address, signTransaction],
	)

	const reset = useCallback(() => setStatus({ status: "idle" }), [])

	return { status, submit, reset }
}

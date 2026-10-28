import { type Transaction } from "@stellar/stellar-sdk"
import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import {
	decodePending,
	isUserRejection,
	OPERATOR_TIMEOUT_SECONDS,
	parseErrorCode,
	type SubmitFailure,
	submitSigned,
} from "@stellar-scaffold/app-lib"
import { type QueryKey, useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"
import { type WriterSigner } from "../config/clients"
import { type Grant, type Standing } from "./useAdminAuthority"
import { depositBalanceKey } from "./useDepositBalance"
import { investorRequestsKey } from "./useInvestorRequests"
import { sharePositionKey } from "./useSharePosition"
import { useWallet } from "./useWallet"

export type TransactionFailure =
	| { kind: "declined" }
	| { kind: "unsigned" }
	| { kind: "cannot-authorize" }
	| { kind: "contract-error"; code: number }
	| { kind: "interrupted" }
	| { kind: "network"; reason: SubmitFailure }
	| { kind: "unknown" }

export type SharedStanding =
	Exclude<Standing, "signs-alone"> | "admin-authorization"

export type SharedTransaction = {
	status: "shared"
	xdr: string
	standing: SharedStanding
	expiresAt: Date | null
}

export type TransactionStatus<
	TConfirmed extends object = Record<never, never>,
> =
	| { status: "idle" }
	| { status: "preparing" }
	| { status: "awaiting-signature" }
	| { status: "submitted"; hash?: string }
	| SharedTransaction
	| ({ status: "confirmed"; hash?: string } & TConfirmed)
	| { status: "failed"; failure: TransactionFailure; hash?: string }

const NO_EXTRA_KEYS: readonly QueryKey[] = []

export interface UseContractTransaction<TArg, TConfirmed extends object> {
	status: TransactionStatus<TConfirmed>
	submit: (arg: TArg, grant?: Grant) => boolean
	reset: () => void
}

const signerFor = (
	owner: string,
	grant: Grant | undefined,
	signTransaction: WriterSigner["signTransaction"],
): WriterSigner =>
	grant === undefined
		? { publicKey: owner, signTransaction }
		: {
				publicKey: grant.authority,
				signTransaction,
				timeoutInSeconds: OPERATOR_TIMEOUT_SECONDS,
			}

const shared = (
	signed: Transaction,
	standing: Exclude<Standing, "signs-alone">,
): SharedTransaction => {
	const xdr = signed.toEnvelope().toXDR("base64")
	return {
		status: "shared",
		xdr,
		standing,
		expiresAt: decodePending(xdr).expiresAt,
	}
}

const awaitingAuthorization = <TResult>(
	tx: AssembledTransaction<TResult>,
): SharedTransaction | null => {
	if (tx.needsNonInvokerSigningBy().length === 0 || tx.built === undefined)
		return null
	return {
		status: "shared",
		xdr: tx.built.toEnvelope().toXDR("base64"),
		standing: "admin-authorization",
		expiresAt: null,
	}
}

const failureOf = (
	error: unknown,
	signatureRequested: boolean,
): TransactionFailure => {
	if (isUserRejection(error)) return { kind: "declined" }
	return signatureRequested ? { kind: "unknown" } : { kind: "interrupted" }
}

const signedOf = <TResult>(tx: AssembledTransaction<TResult>): Transaction => {
	if (tx.signed === undefined) {
		throw new Error("The wallet returned no signed transaction")
	}
	return tx.signed
}

export function useContractTransaction<
	TArg,
	TResult,
	TConfirmed extends object,
>(
	call: (
		signer: WriterSigner,
		arg: TArg,
	) => Promise<AssembledTransaction<TResult>>,
	toConfirmed: (result: TResult) => TConfirmed,
	extraKeys: readonly QueryKey[] = NO_EXTRA_KEYS,
): UseContractTransaction<TArg, TConfirmed> {
	const { address, signTransaction } = useWallet()
	const queryClient = useQueryClient()
	const [status, setStatus] = useState<TransactionStatus<TConfirmed>>({
		status: "idle",
	})
	const submitting = useRef(false)
	const dismissed = useRef(false)
	const lastStatus = useRef<TransactionStatus<TConfirmed>>({ status: "idle" })

	const runSubmission = useCallback(
		async (arg: TArg, owner: string, grant: Grant | undefined) => {
			let hash: string | undefined
			let signatureRequested = false
			let reachedNetwork = false
			const applyStatus = (next: TransactionStatus<TConfirmed>) => {
				lastStatus.current = next
				if (!dismissed.current) setStatus(next)
			}
			const invalidate = (keys: readonly QueryKey[]) => {
				for (const queryKey of keys) {
					void queryClient.invalidateQueries({ queryKey })
				}
			}
			const invalidateRequestData = () =>
				invalidate([
					investorRequestsKey(owner),
					depositBalanceKey(owner),
					sharePositionKey(owner),
					...extraKeys,
				])
			const confirm = (result: TResult) => {
				applyStatus({
					status: "confirmed",
					...toConfirmed(result),
					hash,
				} as TransactionStatus<TConfirmed>)
				invalidateRequestData()
			}
			const submitAsOperator = async (
				tx: AssembledTransaction<TResult>,
				standing: Standing,
			) => {
				await tx.sign()
				const signed = signedOf(tx)
				if (standing !== "signs-alone") {
					applyStatus(shared(signed, standing))
					return
				}
				reachedNetwork = true
				applyStatus({ status: "submitted" })
				const sent = await submitSigned(signed)
				hash = sent.hash
				if (sent.status === "failed") {
					applyStatus({
						status: "failed",
						failure: { kind: "network", reason: sent.reason },
						hash,
					})
					invalidateRequestData()
					return
				}
				confirm(tx.result)
			}
			const signAndSend = async (tx: AssembledTransaction<TResult>) => {
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
					invalidateRequestData()
					return
				}
				confirm(sent.result)
			}
			applyStatus({ status: "preparing" })
			try {
				const tx = await call(signerFor(owner, grant, signTransaction), arg)
				const code = parseErrorCode(tx.simulation)
				if (code !== null) {
					applyStatus({
						status: "failed",
						failure: { kind: "contract-error", code },
					})
					invalidate(extraKeys)
					return
				}
				const awaiting = grant === undefined ? null : awaitingAuthorization(tx)
				if (awaiting !== null) {
					applyStatus(awaiting)
					return
				}
				signatureRequested = true
				applyStatus({ status: "awaiting-signature" })
				if (grant === undefined) await signAndSend(tx)
				else await submitAsOperator(tx, grant.standing)
			} catch (error) {
				applyStatus({
					status: "failed",
					failure: failureOf(error, signatureRequested),
					hash,
				})
				if (reachedNetwork) invalidateRequestData()
			} finally {
				submitting.current = false
			}
		},
		[signTransaction, call, toConfirmed, queryClient, extraKeys],
	)

	const submit = useCallback(
		(arg: TArg, grant?: Grant): boolean => {
			if (address === undefined) return false
			if (submitting.current) {
				dismissed.current = false
				setStatus(lastStatus.current)
				return false
			}
			submitting.current = true
			dismissed.current = false
			void runSubmission(arg, address, grant)
			return true
		},
		[address, runSubmission],
	)

	const reset = useCallback(() => {
		dismissed.current = true
		setStatus({ status: "idle" })
	}, [])

	return { status, submit, reset }
}

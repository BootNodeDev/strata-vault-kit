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
import {
	partialMatchKey,
	type QueryKey,
	useQueryClient,
} from "@tanstack/react-query"
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { type WriterSigner } from "../config/clients"
import { type Grant, type Standing } from "./useAdminAuthority"
import { depositBalanceKey } from "./useDepositBalance"
import { investorRequestsKey } from "./useInvestorRequests"
import { sharePositionKey } from "./useSharePosition"
import { useWallet } from "./useWallet"

export type TransactionFailure =
	| { kind: "declined" }
	| { kind: "unsigned" }
	| { kind: "contract-error"; code: number }
	| { kind: "interrupted" }
	| { kind: "network"; reason: SubmitFailure }
	| { kind: "stale" }
	| { kind: "unknown" }

export type SharedTransaction = {
	status: "shared"
	xdr: string
	standing: Exclude<Standing, "signs-alone">
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

const FRESH_MS = 30_000

type Simulated<TResult> = {
	key: string
	tx: AssembledTransaction<TResult>
	at: number
}

export interface UseContractTransaction<TArg, TConfirmed extends object> {
	status: TransactionStatus<TConfirmed>
	submit: (arg: TArg, grant?: Grant) => boolean
	prepare: (arg: TArg, grant?: Grant) => Release
	reset: () => void
}

const requestKey = (
	owner: string,
	arg: unknown,
	grant: Grant | undefined,
): string =>
	JSON.stringify(
		[owner, arg ?? null, grant?.authority ?? null, grant?.standing ?? null],
		(_name, value: unknown) =>
			typeof value === "bigint" ? `${value}n` : value,
	)

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

export type Release = () => void

type Request<TArg> = { arg: TArg; grant: Grant | undefined }

const isPageHidden = (): boolean => document.visibilityState === "hidden"

const isFresh = (at: number): boolean => Date.now() - at < FRESH_MS

function usePrepared<TArg, TResult>(
	call: (
		signer: WriterSigner,
		arg: TArg,
	) => Promise<AssembledTransaction<TResult>>,
	owner: string | undefined,
	signTransaction: WriterSigner["signTransaction"],
	readKeys: readonly QueryKey[],
	submitting: RefObject<boolean>,
) {
	const queryClient = useQueryClient()
	const simulated = useRef<Simulated<TResult> | null>(null)
	const simulating = useRef<string | null>(null)
	const generation = useRef(0)
	const last = useRef<Request<TArg> | null>(null)
	const reads = useRef(new Map<string, unknown>())
	const expiry = useRef<ReturnType<typeof setTimeout>>(undefined)
	const refresh = useRef(() => {})

	const drop = useCallback(() => {
		simulated.current = null
		simulating.current = null
		generation.current += 1
		clearTimeout(expiry.current)
	}, [])

	const matches = useCallback(
		(queryKey: QueryKey) =>
			readKeys.some((key) => partialMatchKey(queryKey, key)),
		[readKeys],
	)

	const simulate = useCallback(
		(request: Request<TArg>) => {
			if (owner === undefined || submitting.current) return
			const key = requestKey(owner, request.arg, request.grant)
			simulating.current = key
			reads.current = new Map(
				queryClient
					.getQueryCache()
					.findAll()
					.filter((query) => matches(query.queryKey))
					.map((query) => [query.queryHash, query.state.data]),
			)
			const started = generation.current
			const at = Date.now()
			const latest = () =>
				started === generation.current && simulating.current === key
			call(signerFor(owner, request.grant, signTransaction), request.arg).then(
				(tx) => {
					if (!latest()) return
					simulating.current = null
					simulated.current = { key, tx, at }
					expiry.current = setTimeout(
						() => refresh.current(),
						Math.max(0, at + FRESH_MS - Date.now()),
					)
				},
				() => {
					if (latest()) simulating.current = null
				},
			)
		},
		[owner, submitting, queryClient, matches, call, signTransaction],
	)

	useEffect(() => {
		refresh.current = () => {
			const request = last.current
			drop()
			if (request !== null && !isPageHidden()) simulate(request)
		}
	}, [drop, simulate])

	useEffect(
		() => () => {
			last.current = null
			drop()
		},
		[drop],
	)

	useEffect(
		() =>
			queryClient.getQueryCache().subscribe((event) => {
				if (event.type !== "updated" || event.action.type !== "success") return
				if (simulated.current === null && simulating.current === null) return
				const { query } = event
				if (!matches(query.queryKey)) return
				if (reads.current.get(query.queryHash) === query.state.data) return
				refresh.current()
			}),
		[queryClient, matches],
	)

	const prepare = useCallback(
		(arg: TArg, grant?: Grant): Release => {
			const request = { arg, grant }
			const release = () => {
				if (last.current === request) last.current = null
			}
			if (owner === undefined) return release
			last.current = request
			const key = requestKey(owner, arg, grant)
			const cached = simulated.current
			if (cached?.key === key && isFresh(cached.at)) return release
			if (simulating.current === key) return release
			drop()
			simulate(request)
			return release
		},
		[owner, drop, simulate],
	)

	const take = useCallback(
		(key: string): AssembledTransaction<TResult> | undefined => {
			const cached = simulated.current
			last.current = null
			drop()
			if (cached === null || cached.key !== key || !isFresh(cached.at))
				return undefined
			return cached.tx
		},
		[drop],
	)

	return { prepare, take }
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
	const readKeys = useMemo(
		() =>
			address === undefined
				? extraKeys
				: [
						investorRequestsKey(address),
						depositBalanceKey(address),
						sharePositionKey(address),
						...extraKeys,
					],
		[address, extraKeys],
	)

	const { prepare, take } = usePrepared(
		call,
		address,
		signTransaction,
		readKeys,
		submitting,
	)

	const runSubmission = useCallback(
		async (
			arg: TArg,
			owner: string,
			grant: Grant | undefined,
			reused: AssembledTransaction<TResult> | undefined,
		) => {
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
			const signAndSubmit = async (
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
					const stale =
						reused !== undefined && sent.reason === "sequence-consumed"
					applyStatus({
						status: "failed",
						failure: stale
							? { kind: "stale" }
							: { kind: "network", reason: sent.reason },
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
				const tx =
					reused ?? (await call(signerFor(owner, grant, signTransaction), arg))
				const code = parseErrorCode(tx.simulation)
				if (code !== null) {
					applyStatus({
						status: "failed",
						failure: { kind: "contract-error", code },
					})
					invalidate(extraKeys)
					return
				}
				signatureRequested = true
				applyStatus({ status: "awaiting-signature" })
				if (grant === undefined && reused === undefined) await signAndSend(tx)
				else await signAndSubmit(tx, grant?.standing ?? "signs-alone")
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
			const reused = take(requestKey(address, arg, grant))
			void runSubmission(arg, address, grant, reused)
			return true
		},
		[address, runSubmission, take],
	)

	const reset = useCallback(() => {
		dismissed.current = true
		setStatus({ status: "idle" })
	}, [])

	return { status, submit, prepare, reset }
}

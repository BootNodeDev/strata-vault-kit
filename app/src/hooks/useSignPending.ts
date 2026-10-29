import {
	type AccountSigners,
	accountSigners,
	authorizePending,
	type CoSignStep,
	decodePending,
	hasSigned,
	InvalidPendingTransaction,
	latestLedger,
	networkPassphrase,
	type PendingAuthorization,
	type PendingTransaction,
	prepareCoSigned,
	readContract,
	requiredWeight,
	type SignAuthEntry,
	signatureWeight,
	submitSigned,
	transactionStatus,
} from "@stellar-scaffold/app-lib"
import {
	queryOptions,
	skipToken,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useMemo, useRef, useState } from "react"
import { addresses } from "../config/addresses"
import { shareToken } from "../config/clients"
import {
	type AuthorizationState,
	describePending,
	type PendingState,
	pendingState,
	type SignChanges,
	type SignDescription,
	type SignStatus,
} from "../pages/sign"
import { type TransactionFailure } from "./useContractTransaction"
import { pendingChangesQuery } from "./useGovernanceState"
import { identityVerifierQuery } from "./useIsAllowed"
import { useWallet } from "./useWallet"

export const accountSignersKey = (source: string) =>
	["account-signers", source] as const

export const transactionKey = (hash: string) => ["transaction", hash] as const

const tokenAdminQuery = queryOptions({
	queryKey: ["share-token", "admin"] as const,
	queryFn: async () => {
		const read = await readContract(async () =>
			(await shareToken()).get_admin(),
		)
		if (read.kind !== "value") {
			throw new Error(`share token get_admin read failed: ${read.kind}`)
		}
		return read.value ?? null
	},
	retry: false,
})

const latestLedgerKey = ["latest-ledger"] as const

const signAddresses = (identityVerifier: string) => ({
	vault: addresses.async_vault,
	oracle: addresses.nav_oracle,
	shareToken: addresses.share_token,
	identityVerifier,
})

export interface UseSignPending {
	xdr: string
	loading: boolean
	pending: PendingTransaction | null
	description: SignDescription | null
	signers: AccountSigners | null | undefined
	signedBy: string[]
	weight: number
	state: PendingState
	canSign: boolean
	canSubmit: boolean
	status: SignStatus
	sign: () => void
	submit: () => void
	reset: () => void
}

type Decoded = { pending: PendingTransaction; description: SignDescription }

const decode = (
	xdr: string,
	identityVerifier: string,
	changes: SignChanges,
): Decoded | null => {
	try {
		const pending = decodePending(xdr)
		return {
			pending,
			description: describePending(
				pending,
				signAddresses(identityVerifier),
				changes,
			),
		}
	} catch (error) {
		if (error instanceof InvalidPendingTransaction) return null
		throw error
	}
}

const isEnvelope = (xdr: string): boolean => {
	try {
		decodePending(xdr)
		return true
	} catch (error) {
		if (error instanceof InvalidPendingTransaction) return false
		throw error
	}
}

const countersigned = (
	signedXdr: string,
	previous: PendingTransaction,
	address: string,
	signedBefore: string[],
	signers: AccountSigners,
): PendingTransaction | null => {
	let next: PendingTransaction
	try {
		next = decodePending(signedXdr)
	} catch (error) {
		if (error instanceof InvalidPendingTransaction) return null
		throw error
	}
	if (next.hash !== previous.hash) return null
	if (!hasSigned(next.transaction, address)) return null
	const { signedBy } = signatureWeight(next.transaction, signers)
	return signedBefore.every((key) => signedBy.includes(key)) ? next : null
}

const NOBODY = { signedBy: [] as string[], weight: 0 }

const USER_REJECTED = -4
const UNSUPPORTED = -3

const signFailure = (error: unknown): TransactionFailure => {
	const code =
		typeof error === "object" && error !== null && "code" in error
			? error.code
			: undefined
	if (code === USER_REJECTED) return { kind: "declined" }
	if (code === UNSUPPORTED) return { kind: "cannot-authorize" }
	return { kind: "unsigned" }
}

const authorizedBy = (
	decoded: Decoded | null,
	admin: string | null | undefined,
	adminFailed: boolean,
): Decoded | null | undefined => {
	const authorization = decoded?.pending.authorization
	if (decoded === null || authorization == null) return decoded
	if (decoded.pending.contractId !== addresses.share_token) return null
	if (admin === undefined) return adminFailed ? null : undefined
	return admin === authorization.address ? decoded : null
}

const authorizationState = (
	authorization: PendingAuthorization | null | undefined,
	ledger: number | undefined,
): AuthorizationState => {
	if (authorization == null) return "none"
	if (!authorization.signed) return "awaiting"
	if (ledger !== undefined && ledger >= authorization.expirationLedger)
		return "expired"
	return "authorized"
}

export function useSignPending(initialXdr: string): UseSignPending {
	const { address, signTransaction, signAuthEntry } = useWallet()
	const queryClient = useQueryClient()
	const [xdr, setXdr] = useState(initialXdr)
	const [status, setStatus] = useState<SignStatus>({ status: "idle" })
	const busy = useRef(false)
	const dismissed = useRef(false)

	const { data: liveVerifier, isError: verifierFailed } = useQuery({
		...identityVerifierQuery,
		retry: false,
	})
	const verifier =
		liveVerifier ?? (verifierFailed ? addresses.identity_verifier : undefined)
	const { data: vaultChanges } = useQuery(pendingChangesQuery("vault"))
	const { data: tokenChanges } = useQuery(pendingChangesQuery("token"))
	const { data: oracleChanges } = useQuery(pendingChangesQuery("oracle"))
	const envelope = useMemo(() => isEnvelope(xdr), [xdr])
	const described = useMemo(
		() =>
			verifier === undefined
				? null
				: decode(xdr, verifier, {
						vault: vaultChanges?.pending,
						token: tokenChanges?.pending,
						oracle: oracleChanges?.pending,
					}),
		[xdr, verifier, vaultChanges, tokenChanges, oracleChanges],
	)
	const authorization = described?.pending.authorization ?? null
	const { data: admin, isError: adminFailed } = useQuery({
		...tokenAdminQuery,
		enabled: authorization !== null,
	})
	const checked = authorizedBy(described, admin, adminFailed)
	const decoded = checked ?? null
	const { data: ledger } = useQuery({
		queryKey: latestLedgerKey,
		queryFn: decoded?.pending.authorization?.signed ? latestLedger : skipToken,
	})
	const source = decoded?.pending.source
	const { data: signers } = useQuery({
		queryKey: accountSignersKey(source ?? ""),
		queryFn: source === undefined ? skipToken : () => accountSigners(source),
	})

	const collected = useMemo(
		() =>
			decoded && signers
				? signatureWeight(decoded.pending.transaction, signers)
				: NOBODY,
		[decoded, signers],
	)
	const walletHasSigned =
		decoded !== null &&
		address !== undefined &&
		hasSigned(decoded.pending.transaction, address)
	const walletIsSigner =
		signers && address !== undefined
			? signers.signers.some(({ key, weight }) => key === address && weight > 0)
			: null
	const sequenceState: PendingState =
		decoded === null
			? "valid"
			: pendingState({
					now: new Date(),
					expiresAt: decoded.pending.expiresAt,
					sequence: decoded.pending.sequence,
					accountSequence: signers?.sequence ?? null,
					weight: collected.weight,
					threshold: signers
						? requiredWeight(signers)
						: Number.POSITIVE_INFINITY,
					walletIsSigner,
					walletHasSigned,
					authorization: authorizationState(
						decoded.pending.authorization,
						ledger,
					),
				})
	const hash = decoded?.pending.hash
	const { data: outcome } = useQuery({
		queryKey: transactionKey(hash ?? ""),
		queryFn:
			(sequenceState === "consumed" || sequenceState === "expired") &&
			hash !== undefined
				? () => transactionStatus(hash)
				: skipToken,
		staleTime: (query) => (query.state.data === "success" ? Infinity : 0),
	})
	const state: PendingState =
		(sequenceState === "consumed" || sequenceState === "expired") &&
		outcome === "success"
			? "executed"
			: sequenceState
	const walletIsAdmin =
		address !== undefined && decoded?.pending.authorization?.address === address
	const canSign =
		(state === "valid" && walletIsSigner === true) ||
		(state === "awaiting-authorization" && walletIsAdmin)
	const canSubmit = state === "ready"

	const apply = useCallback((next: SignStatus) => {
		if (!dismissed.current) setStatus(next)
	}, [])

	const run = useCallback(
		async (pending: PendingTransaction) => {
			apply({ status: "submitted" })
			const sent = await submitSigned(pending.transaction)
			if (sent.status === "failed") {
				apply({
					status: "failed",
					failure: { kind: "network", reason: sent.reason },
					hash: sent.hash,
				})
			} else {
				queryClient.setQueryData(transactionKey(pending.hash), "success")
				apply({ status: "confirmed", hash: sent.hash, result: sent.result })
			}
			void queryClient.invalidateQueries({
				queryKey: accountSignersKey(pending.source),
			})
		},
		[apply, queryClient],
	)

	const guarded = useCallback(
		(work: () => Promise<void>) => {
			if (busy.current) return
			busy.current = true
			dismissed.current = false
			void work()
				.catch(() => {
					apply({ status: "failed", failure: { kind: "unknown" } })
				})
				.finally(() => {
					busy.current = false
				})
		},
		[apply],
	)

	const replaceXdr = useCallback((next: string) => {
		window.history.replaceState(window.history.state, "", `#${next}`)
		setXdr(next)
	}, [])

	const authorize = useCallback(
		async (pending: PendingTransaction, wallet: string) => {
			const signAs: SignAuthEntry = (entry, opts) =>
				signAuthEntry(entry, { ...opts, networkPassphrase, address: wallet })
			const step = await authorizePending(
				(await shareToken()).txFromXDR(xdr),
				pending,
				signAs,
			).catch((error: unknown) => signFailure(error))
			if (step.kind === "refused") {
				apply({
					status: "failed",
					failure: { kind: "contract-error", code: step.code },
				})
			} else if (step.kind === "ready") {
				replaceXdr(step.xdr)
			} else {
				apply({ status: "failed", failure: step })
			}
		},
		[xdr, signAuthEntry, apply, replaceXdr],
	)

	const envelopeToSign = useCallback(
		async (
			pending: PendingTransaction,
			signedBefore: string[],
		): Promise<CoSignStep> => {
			if (pending.authorization === null || signedBefore.length > 0)
				return { kind: "ready", xdr, pending }
			return prepareCoSigned((await shareToken()).txFromXDR(xdr), pending)
		},
		[xdr],
	)

	const countersign = useCallback(
		async (
			pending: PendingTransaction,
			wallet: string,
			signers: AccountSigners,
		) => {
			const prepared = await envelopeToSign(pending, collected.signedBy)
			if (prepared.kind === "refused") {
				apply({
					status: "failed",
					failure: { kind: "contract-error", code: prepared.code },
				})
				return
			}
			const signed = await signTransaction(prepared.xdr, {
				networkPassphrase,
				address: wallet,
			}).catch((error: unknown) => signFailure(error))
			if ("kind" in signed) {
				apply({ status: "failed", failure: signed })
				return
			}
			const next = countersigned(
				signed.signedTxXdr,
				prepared.pending,
				wallet,
				collected.signedBy,
				signers,
			)
			if (next === null) {
				apply({ status: "failed", failure: { kind: "unsigned" } })
				return
			}
			replaceXdr(signed.signedTxXdr)
			const { weight } = signatureWeight(next.transaction, signers)
			if (weight >= requiredWeight(signers)) await run(next)
		},
		[
			envelopeToSign,
			collected.signedBy,
			apply,
			signTransaction,
			replaceXdr,
			run,
		],
	)

	const sign = useCallback(() => {
		if (!canSign || address === undefined || !signers || decoded === null)
			return
		guarded(() =>
			state === "awaiting-authorization"
				? authorize(decoded.pending, address)
				: countersign(decoded.pending, address, signers),
		)
	}, [
		canSign,
		address,
		signers,
		decoded,
		state,
		guarded,
		authorize,
		countersign,
	])

	const submit = useCallback(() => {
		if (!canSubmit || decoded === null) return
		guarded(() => run(decoded.pending))
	}, [canSubmit, decoded, guarded, run])

	const reset = useCallback(() => {
		dismissed.current = true
		setStatus({ status: "idle" })
	}, [])

	return {
		xdr,
		loading: envelope && (verifier === undefined || checked === undefined),
		pending: decoded?.pending ?? null,
		description: decoded?.description ?? null,
		signers,
		signedBy: collected.signedBy,
		weight: collected.weight,
		state,
		canSign,
		canSubmit,
		status,
		sign,
		submit,
		reset,
	}
}

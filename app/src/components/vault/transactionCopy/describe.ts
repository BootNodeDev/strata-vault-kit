import {
	type ContractError,
	type SubmitFailure,
} from "@stellar-scaffold/app-lib"
import {
	type TransactionFailure,
	type TransactionStatus,
} from "../../../hooks/useContractTransaction"
import { type Content, type Copy, type StatusCopy } from "./types"

export const GENERIC_REFUSAL =
	"The vault refused this request. Try again, and contact support if it keeps happening."

const NETWORK_REASONS: Record<Exclude<SubmitFailure, "unknown">, string> = {
	expired: "The transaction expired before it was submitted.",
	"sequence-consumed":
		"The account moved on; this transaction is no longer valid.",
	"bad-auth": "The signatures do not match the account's threshold.",
	fee: "The account cannot pay the fee.",
	"fee-too-low": "The fee is below the network minimum. Propose it again.",
	"not-accepted": "The network did not accept it. Try again.",
}

const unknownOutcome = (followUp: string) => ({
	heading: "Something went wrong",
	body: `We could not confirm whether this reached the network. We don't yet know if it went through, so ${followUp}.`,
})

const contractErrorReason = (
	copy: Pick<StatusCopy, "reasons" | "fallback" | "fallbackFor">,
	{ code, name }: ContractError,
): string =>
	(name !== undefined && Object.hasOwn(copy.reasons, name)
		? copy.reasons[name]
		: undefined) ??
	copy.fallbackFor?.(code) ??
	copy.fallback

const describeFailure = (
	failure: TransactionFailure,
	copy: Pick<
		StatusCopy,
		"reasons" | "fallback" | "fallbackFor" | "followUp" | "refuser"
	>,
): Copy => {
	switch (failure.kind) {
		case "network":
			if (failure.reason === "unknown") return unknownOutcome(copy.followUp)
			return {
				heading: "The network rejected it",
				body: NETWORK_REASONS[failure.reason],
			}
		case "declined":
			return {
				heading: "You declined the request",
				body: "You chose not to sign, so nothing was sent. Try again when you're ready.",
			}
		case "unsigned":
			return {
				heading: "The wallet did not sign",
				body: "Nothing was sent. Try again when you're ready.",
			}
		case "cannot-authorize":
			return {
				heading: "This wallet cannot authorize",
				body: "This wallet cannot sign authorizations. Use Freighter, Hana or WalletConnect.",
			}
		case "contract-error":
			return {
				heading: `The ${copy.refuser} refused this request`,
				body: contractErrorReason(copy, failure),
			}
		case "interrupted":
			return {
				heading: "We couldn't reach the vault",
				body: "Nothing was requested from your wallet. Try again when you're ready.",
			}
		case "stale":
			return {
				heading: "The transaction went stale",
				body: "The account moved on since it was prepared, so nothing was sent. Try again.",
			}
		case "unknown":
			return unknownOutcome(copy.followUp)
	}
}

export const describeStatus = <TConfirmed extends object>(
	copy: StatusCopy<TConfirmed>,
	status: TransactionStatus<TConfirmed>,
): Content | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return copy.preparing
		case "awaiting-signature":
			return copy.awaitingSignature
		case "submitted":
			return { ...copy.submitted, hash: status.hash }
		case "shared":
			return copy.shared?.(status)
		case "confirmed":
			return { ...copy.confirmed(status), hash: status.hash }
		case "failed":
			return { ...describeFailure(status.failure, copy), hash: status.hash }
	}
}

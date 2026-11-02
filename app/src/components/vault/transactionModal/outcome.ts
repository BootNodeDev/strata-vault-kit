import { formatDate, type SubmitFailure } from "@stellar-scaffold/app-lib"
import { type TransactionFailure } from "../../../hooks/useContractTransaction"

export const GENERIC_REFUSAL =
	"The vault refused this request. Try again, and contact support if it keeps happening."

const INVESTOR_FOLLOW_UP = "check your requests before doing anything else"
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

export const describeFailure = (
	failure: TransactionFailure,
	contractErrorReason: (code: number) => string,
	followUp = INVESTOR_FOLLOW_UP,
	refuser = "vault",
): { heading: string; body: string } => {
	switch (failure.kind) {
		case "network":
			if (failure.reason === "unknown") return unknownOutcome(followUp)
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
				heading: `The ${refuser} refused this request`,
				body: contractErrorReason(failure.code),
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
			return unknownOutcome(followUp)
	}
}

export const describeShared = (expiresAt: Date | null) => {
	const invitation = "Share the link with the next signer."
	if (expiresAt === null) return invitation
	const seconds = BigInt(Math.floor(expiresAt.getTime() / 1000))
	return `${invitation} Valid until ${formatDate(seconds)}.`
}

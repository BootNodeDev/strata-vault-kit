import {
	AMOUNT_DECIMALS,
	explorerTransaction,
	formatDate,
	formatExact,
	formatScaled,
	PRICE_DECIMALS,
	shortAddress,
	type SubmitFailure,
} from "@stellar-scaffold/app-lib"
import React from "react"
import { type ActivateWindDownStatus } from "../../hooks/useActivateWindDown"
import { type AttestStatus } from "../../hooks/useAttest"
import { type CancelDepositStatus } from "../../hooks/useCancelDeposit"
import { type CancelRedeemStatus } from "../../hooks/useCancelRedeem"
import { type ClaimDepositStatus } from "../../hooks/useClaimDeposit"
import { type ClaimRedeemStatus } from "../../hooks/useClaimRedeem"
import { type CloseEpochStatus } from "../../hooks/useCloseEpoch"
import {
	type TransactionFailure,
	type TransactionStatus,
} from "../../hooks/useContractTransaction"
import { type DeployToCustodianStatus } from "../../hooks/useDeployToCustodian"
import { type FinalizeWindDownRoundStatus } from "../../hooks/useFinalizeWindDownRound"
import { type FulfillEpochStatus } from "../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../hooks/useFund"
import { type RequestDepositStatus } from "../../hooks/useRequestDeposit"
import { type RequestRedeemStatus } from "../../hooks/useRequestRedeem"
import { describeStanding } from "../../pages/actions"
import { type ComplianceActionId } from "../../pages/compliance"
import { EFFECTS } from "../../pages/configuration"
import { type GovernanceActionId } from "../../pages/governance"
import typeStyles from "../../styles/type.module.css"
import Close from "../icons/Close"
import ExternalLink from "../icons/ExternalLink"
import styles from "./TransactionModal.module.css"

export type EmergencyModalAction =
	| "pause-vault"
	| "unpause-vault"
	| "pause-nav"
	| "unpause-nav"
	| "clear-latest"
	| "pause-token"
	| "unpause-token"

export type ConfigurationModalAction =
	| "set-deposit-cap"
	| "set-custodian"
	| "set-notice"
	| "set-wind-down-delay"
	| "propose-custodian"
	| "propose-notice"
	| "propose-wind-down-delay"
	| "set-oracle-config"
	| "propose-oracle-config"
	| "set-compliance"
	| "propose-compliance"
	| "set-identity-verifier"
	| "propose-identity-verifier"

export type GovernanceModalAction =
	GovernanceActionId | "propose-oracle-revoke-role"

export type ComplianceModalAction = ComplianceActionId

export type AdminModalAction =
	| EmergencyModalAction
	| ConfigurationModalAction
	| GovernanceModalAction
	| ComplianceModalAction

export type TransactionModalProps =
	| {
			action: EmergencyModalAction
			status: TransactionStatus
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action:
				ConfigurationModalAction | GovernanceModalAction | ComplianceModalAction
			status: TransactionStatus
			value: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "subscribe"
			status: RequestDepositStatus
			amount: string
			ticker: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "cancel"
			status: CancelDepositStatus
			amount: string
			ticker: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "cancel-redeem"
			status: CancelRedeemStatus
			amount: string
			ticker: string
			assetTicker: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "claim"
			status: ClaimDepositStatus
			amount: string
			ticker: string
			shareTicker: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "redeem"
			status: RequestRedeemStatus
			amount: string
			ticker: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "claim-redeem"
			status: ClaimRedeemStatus
			amount: string
			ticker: string
			uncovered?: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "close-epoch"
			status: CloseEpochStatus
			epoch: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "fulfill-epoch"
			status: FulfillEpochStatus
			epoch: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "attest"
			status: AttestStatus
			price: string
			validFor: string | null
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "deploy"
			status: DeployToCustodianStatus
			amount: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "fund"
			status: FundStatus
			amount: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "activate-wind-down"
			status: ActivateWindDownStatus
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "finalize-round"
			status: FinalizeWindDownRoundStatus
			round: string
			onClose: () => void
			onRetry: () => void
	  }

const GENERIC_REFUSAL =
	"The vault refused this request. Try again, and contact support if it keeps happening."

const subscribeContractErrorReason = (code: number): string => {
	switch (code) {
		case 6007:
			return "Enter an amount greater than zero."
		case 6009:
			return "You already have a subscription request open."
		case 6014:
			return "That amount is too large for the vault to accept."
		case 6046:
			return "The vault is winding down and is not accepting new subscriptions."
		case 6064:
			return "The vault's setup is still open. Subscriptions start once it closes."
		default:
			return GENERIC_REFUSAL
	}
}

const cancelContractErrorReason = (code: number): string => {
	switch (code) {
		case 6001:
			return "This request no longer exists to cancel."
		case 6029:
			return "This request could not be found."
		case 6039:
			return "This request has already been priced. Claim your shares instead of cancelling."
		case 6041:
			return "A price is available, so this request can no longer be cancelled. It will be priced shortly, and your shares are claimable once it is."
		default:
			return GENERIC_REFUSAL
	}
}

const cancelRedeemContractErrorReason = (
	code: number,
	assetTicker: string,
): string => {
	if (code === 304) {
		return `Your address is no longer allowlisted, so these shares cannot be returned to you. Once priced, claim the ${assetTicker} it owes you instead.`
	}
	return cancelContractErrorReason(code)
}

const claimContractErrorReason = (code: number): string => {
	switch (code) {
		case 6001:
			return "You have no request to claim."
		case 6014:
			return "The share conversion for this claim is too large to complete."
		case 6029:
			return "This request could not be found."
		case 6031:
			return "The vault has not published a valid price for this request yet."
		case 6035:
			return "This request has already been claimed."
		case 6037:
			return "The vault does not yet hold enough in reserve to cover this claim. Try again shortly."
		case 304:
			return "Your address is no longer allowlisted, so it cannot receive shares."
		default:
			return GENERIC_REFUSAL
	}
}

const redeemContractErrorReason = (code: number): string => {
	switch (code) {
		case 6007:
			return "Enter an amount greater than zero."
		case 6009:
			return "You already have a redemption request open."
		case 6014:
			return "That amount is too large for the vault to accept."
		case 6029:
			return "This request could not be found."
		case 6046:
			return "The vault is winding down and is not accepting new redemptions."
		default:
			return GENERIC_REFUSAL
	}
}

const claimRedeemContractErrorReason = (
	code: number,
	ticker: string,
	uncovered?: string,
): string => {
	switch (code) {
		case 6034:
			return "This request has not priced yet. Check back after the vault's next update."
		case 6037:
			return uncovered !== undefined
				? `The vault is ${uncovered} short of covering every priced claim. Try again once the reserve catches up.`
				: `The vault does not yet hold enough ${ticker} in reserve to cover this claim. Try again shortly.`
		case 304:
			return "The price left nothing to claim, so the vault tried to return your shares instead. Your address is no longer allowlisted to receive them."
		default:
			return claimContractErrorReason(code)
	}
}

const closeEpochContractErrorReason = (code: number): string => {
	switch (code) {
		case 6046:
			return "The vault is winding down, so no more epochs can be sealed."
		case 6029:
			return "The current epoch could not be found."
		case 6032:
			return "The current epoch is not open, so there is nothing to seal."
		case 2000:
			return "This wallet is not authorized to close epochs."
		case 2007:
			return "This wallet does not hold the manager role."
		default:
			return GENERIC_REFUSAL
	}
}

const fulfillEpochContractErrorReason = (code: number): string => {
	switch (code) {
		case 6046:
			return "The vault is winding down, so epochs can no longer be priced."
		case 6029:
			return "This epoch could not be found."
		case 6038:
			return "This epoch is not sealed, so it cannot be priced."
		case 6042:
			return "The notice period has not elapsed yet."
		case 6044:
			return "The oracle price is not valid right now."
		case 6043:
			return "The latest price was attested before this epoch was sealed. A fresh attestation is needed."
		case 6031:
			return "The vault could not resolve a valid share price."
		case 6014:
			return "The settlement total is too large for the vault to record."
		case 1000:
			return "The vault is paused, so epochs cannot be priced."
		default:
			return GENERIC_REFUSAL
	}
}

const attestContractErrorReason = (code: number): string => {
	switch (code) {
		case 3002:
			return "That price is outside the band the oracle accepts."
		case 3005:
			return "The attestation would already have expired when recorded."
		case 3003:
			return "The cooldown since the last attestation has not elapsed yet."
		case 3004:
			return "That price moves further from the last attested price than the oracle allows."
		case 3010:
			return "Unpause the NAV first."
		case 3023:
			return "The proof hash cannot be all zeros."
		case 3024:
			return "The proof URI is longer than 256 bytes."
		default:
			return GENERIC_REFUSAL
	}
}

const deployContractErrorReason = (code: number): string => {
	switch (code) {
		case 6046:
			return "The vault is winding down, so nothing can leave for the custodian."
		case 6007:
			return "Enter an amount greater than zero."
		case 6012:
			return "No custodian is set, so there is nowhere to deploy to."
		case 6005:
			return "That amount exceeds the free reserve. The rest is committed to priced exits."
		case 6014:
			return "That amount is too large for the vault to record."
		case 2000:
			return "This wallet is not authorized to deploy to the custodian."
		case 2007:
			return "This wallet does not hold the treasury role."
		default:
			return GENERIC_REFUSAL
	}
}

const fundContractErrorReason = (code: number): string => {
	switch (code) {
		case 6007:
			return "Enter an amount greater than zero."
		case 6014:
			return "That amount is too large for the vault to record."
		default:
			return code < 6000
				? "Your wallet could not cover the transfer. Check the balance and the trustline."
				: GENERIC_REFUSAL
	}
}

const activateWindDownContractErrorReason = (code: number): string => {
	switch (code) {
		case 6047:
			return "No wind-down has been proposed, so there is nothing to activate."
		case 6046:
			return "The wind-down is already active."
		case 6049:
			return "The wind-down delay has not elapsed yet."
		default:
			return GENERIC_REFUSAL
	}
}

const finalizeRoundContractErrorReason = (code: number): string => {
	switch (code) {
		case 6050:
			return "The wind-down is not active, so no round can be finalized."
		case 6052:
			return "There is nothing to distribute: the free reserve is empty or too small to split across holders."
		case 6014:
			return "The round is too large for the vault to record."
		default:
			return GENERIC_REFUSAL
	}
}

const INVESTOR_FOLLOW_UP = "check your requests before doing anything else"
const OPERATOR_FOLLOW_UP = "check the Cycle card before trying again"
const EMERGENCY_FOLLOW_UP = "check the Emergency tab before trying again"
const CONFIGURATION_FOLLOW_UP =
	"check the Configuration tab before trying again"
const GOVERNANCE_FOLLOW_UP = "check the Governance tab before trying again"
const COMPLIANCE_FOLLOW_UP = "check the Compliance tab before trying again"

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

const describeFailure = (
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

const describeShared = (expiresAt: Date | null) => {
	const invitation = "Share the link with the next signer."
	if (expiresAt === null) return invitation
	const seconds = BigInt(Math.floor(expiresAt.getTime() / 1000))
	return `${invitation} Valid until ${formatDate(seconds)}.`
}

const describeSubscribeStatus = (
	status: RequestDepositStatus,
	amount: string,
	ticker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your request",
				body: "We are getting your request ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Your shares are set once the vault prices your request, not today. Signing locks ${amount} ${ticker} in escrow until then.`,
			}
		case "submitted":
			return {
				heading: "Sending your request",
				body: "Your request is on its way to the network. This should only take a moment, while pricing comes later and takes longer. Closing this window will not cancel it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Request submitted",
				body: `${amount} ${ticker} prices at the vault's next update.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(status.failure, subscribeContractErrorReason),
				hash: status.hash,
			}
	}
}

const describeCancelStatus = (
	status: CancelDepositStatus,
	amount: string,
	ticker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your cancellation",
				body: "We are getting your cancellation ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Your request is withdrawn, not priced. Signing returns ${amount} ${ticker} from escrow to your wallet.`,
			}
		case "submitted":
			return {
				heading: "Sending your cancellation",
				body: "Your cancellation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Request cancelled",
				body: `${formatExact(status.refundedAmount, AMOUNT_DECIMALS)} ${ticker} has been returned to your wallet.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(status.failure, cancelContractErrorReason),
				hash: status.hash,
			}
	}
}

const describeCancelRedeemStatus = (
	status: CancelRedeemStatus,
	amount: string,
	ticker: string,
	assetTicker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your cancellation",
				body: "We are getting your cancellation ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Your request is withdrawn, not priced. Signing returns ${amount} ${ticker} from escrow to your wallet.`,
			}
		case "submitted":
			return {
				heading: "Sending your cancellation",
				body: "Your cancellation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Request cancelled",
				body: `${formatExact(status.returnedShares, AMOUNT_DECIMALS)} ${ticker} has been returned to your wallet.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(status.failure, (code) =>
					cancelRedeemContractErrorReason(code, assetTicker),
				),
				hash: status.hash,
			}
	}
}

const describeClaimStatus = (
	status: ClaimDepositStatus,
	amount: string,
	ticker: string,
	shareTicker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your claim",
				body: "We are getting your claim ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `You receive what you're owed. If the price leaves no shares to claim, ${amount} ${ticker} returns to your wallet instead.`,
			}
		case "submitted":
			return {
				heading: "Sending your claim",
				body: "Your claim is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return status.sharesMinted > 0n
				? {
						heading: "Shares claimed",
						body: `${formatExact(status.sharesMinted, AMOUNT_DECIMALS)} ${shareTicker} has been added to your wallet.`,
						hash: status.hash,
					}
				: {
						heading: "Deposit returned",
						body: `The price left no shares to claim, so ${amount} ${ticker} has been returned to your wallet instead.`,
						hash: status.hash,
					}
		case "failed":
			return {
				...describeFailure(status.failure, claimContractErrorReason),
				hash: status.hash,
			}
	}
}

const describeRedeemStatus = (
	status: RequestRedeemStatus,
	amount: string,
	ticker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your redemption request",
				body: "We are getting your redemption request ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `What you're owed is set once the vault prices your request, not today. Signing locks ${amount} ${ticker} in escrow until then.`,
			}
		case "submitted":
			return {
				heading: "Sending your redemption request",
				body: "Your redemption request is on its way to the network. This should only take a moment, while pricing comes later and takes longer. Closing this window will not cancel it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Redemption request submitted",
				body: `${amount} ${ticker} prices at the vault's next update.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(status.failure, redeemContractErrorReason),
				hash: status.hash,
			}
	}
}

const describeClaimRedeemStatus = (
	status: ClaimRedeemStatus,
	amount: string,
	ticker: string,
	uncovered?: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your claim",
				body: "We are getting your claim ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `You receive what you're owed. Signing sends ${amount} ${ticker} to your wallet.`,
			}
		case "submitted":
			return {
				heading: "Sending your claim",
				body: "Your claim is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return status.assetsClaimed > 0n
				? {
						heading: `${ticker} claimed`,
						body: `${formatExact(status.assetsClaimed, AMOUNT_DECIMALS)} ${ticker} has been added to your wallet.`,
						hash: status.hash,
					}
				: {
						heading: "Shares returned",
						body: "The price left nothing to claim, so your shares have been returned to your wallet instead.",
						hash: status.hash,
					}
		case "failed":
			return {
				...describeFailure(status.failure, (code) =>
					claimRedeemContractErrorReason(code, ticker, uncovered),
				),
				hash: status.hash,
			}
	}
}

const describeCloseEpochStatus = (
	status: CloseEpochStatus,
	epoch: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing to close epoch ${epoch}`,
				body: "We are getting the close ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Signing seals epoch ${epoch} and opens the next one. Requests in epoch ${epoch} wait for a price.`,
			}
		case "submitted":
			return {
				heading: "Sending the close",
				body: "The close is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: `Epoch ${status.sealedEpoch} sealed`,
				body: `Epoch ${status.sealedEpoch + 1n} is open and accepting requests. Epoch ${status.sealedEpoch} prices once the notice elapses and a valid price is attested.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(
					status.failure,
					closeEpochContractErrorReason,
					OPERATOR_FOLLOW_UP,
				),
				hash: status.hash,
			}
	}
}

const describeFulfillEpochStatus = (
	status: FulfillEpochStatus,
	epoch: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing to price epoch ${epoch}`,
				body: "We are getting the settlement ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Signing prices epoch ${epoch} at the oracle's current price and settles its requests.`,
			}
		case "submitted":
			return {
				heading: "Sending the settlement",
				body: "The settlement is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: `Epoch ${epoch} priced`,
				body: `Settled at ${formatScaled(status.sharePrice, PRICE_DECIMALS, 4)} per share. Share claims are ready; redemption claims wait until the reserve covers them.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(
					status.failure,
					fulfillEpochContractErrorReason,
					OPERATOR_FOLLOW_UP,
				),
				hash: status.hash,
			}
	}
}

const describeAttestStatus = (
	status: AttestStatus,
	price: string,
	validFor: string | null,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing to attest ${price}`,
				body: "We are getting the attestation ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Signing records ${price} as the share price, with its proof. Sealed epochs settle at it once their notice elapses.`,
			}
		case "submitted":
			return {
				heading: "Sending the attestation",
				body: "The attestation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Price attested",
				body:
					validFor === null
						? `${price} is the share price.`
						: `${price} is the share price. Valid for ${validFor}.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(
					status.failure,
					attestContractErrorReason,
					OPERATOR_FOLLOW_UP,
				),
				hash: status.hash,
			}
	}
}

const describeDeployStatus = (
	status: DeployToCustodianStatus,
	amount: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing to deploy ${amount}`,
				body: "We are getting the deployment ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Signing sends ${amount} from the vault's reserve to the custodian.`,
			}
		case "submitted":
			return {
				heading: "Sending the deployment",
				body: "The deployment is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Deployed",
				body: `${amount} left the vault for the custodian.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(
					status.failure,
					deployContractErrorReason,
					OPERATOR_FOLLOW_UP,
				),
				hash: status.hash,
			}
	}
}

const describeFundStatus = (
	status: FundStatus,
	amount: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing to fund ${amount}`,
				body: "We are getting the funding ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Signing moves ${amount} from your wallet into the vault's reserve.`,
			}
		case "submitted":
			return {
				heading: "Sending the funding",
				body: "The funding is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Funded",
				body: `${amount} joined the reserve.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(
					status.failure,
					fundContractErrorReason,
					OPERATOR_FOLLOW_UP,
				),
				hash: status.hash,
			}
	}
}

const describeActivateWindDownStatus = (
	status: ActivateWindDownStatus,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing to activate the wind-down",
				body: "We are getting the activation ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: "Signing stops new requests and opens distribution rounds.",
			}
		case "submitted":
			return {
				heading: "Sending the activation",
				body: "The activation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Wind-down active",
				body: "New requests are closed. Rounds can now distribute the free reserve.",
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(
					status.failure,
					activateWindDownContractErrorReason,
					OPERATOR_FOLLOW_UP,
				),
				hash: status.hash,
			}
	}
}

const describeFinalizeRoundStatus = (
	status: FinalizeWindDownRoundStatus,
	round: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing round ${round}`,
				body: "We are getting the round ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `Signing distributes the free reserve to holders as round ${round}.`,
			}
		case "submitted":
			return {
				heading: "Sending the round",
				body: "The round is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: `Round ${round} finalized`,
				body: `${formatExact(status.credited, AMOUNT_DECIMALS)} is claimable by holders.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(
					status.failure,
					finalizeRoundContractErrorReason,
					OPERATOR_FOLLOW_UP,
				),
				hash: status.hash,
			}
	}
}

type AdminCopy = {
	refuser: "vault" | "share token" | "oracle" | "identity verifier"
	reasons?: Partial<Record<number, string>>
	verb: string
	signing: string
	done: string
	doneBody: string
}

const EMERGENCY_COPY: Record<EmergencyModalAction, AdminCopy> = {
	"pause-vault": {
		refuser: "vault",
		verb: "pause the vault",
		signing: "Signing stops new deposits, pricing and upgrades.",
		done: "Vault paused",
		doneBody:
			"New deposits, pricing and upgrades are stopped. Redemptions, claims, cancels and closing epochs stay open.",
	},
	"unpause-vault": {
		refuser: "vault",
		verb: "unpause the vault",
		signing: "Signing resumes deposits, pricing and upgrades.",
		done: "Vault unpaused",
		doneBody: "Deposits, pricing and upgrades are open again.",
	},
	"pause-nav": {
		refuser: "oracle",
		verb: "pause the NAV",
		signing: "Signing stops pricing until the NAV is unpaused.",
		done: "NAV paused",
		doneBody:
			"Pricing is stopped. No epoch can be fulfilled until the NAV is unpaused.",
	},
	"unpause-nav": {
		refuser: "oracle",
		verb: "unpause the NAV",
		signing: "Signing resumes pricing.",
		done: "NAV unpaused",
		doneBody: "Epochs can be fulfilled again while the price is valid.",
	},
	"clear-latest": {
		refuser: "oracle",
		verb: "clear the latest price",
		signing: "Signing removes the recorded price.",
		done: "Latest price cleared",
		doneBody:
			"The next attestation is not limited by its distance from the last. Pricing stays stopped until the NAV is unpaused.",
	},
	"pause-token": {
		refuser: "share token",
		verb: "pause the share token",
		signing: "Signing stops holder transfers and returns of escrowed shares.",
		done: "Share token paused",
		doneBody:
			"Holder transfers and returns of escrowed shares are stopped. Minting, burning and forced transfers stay open.",
	},
	"unpause-token": {
		refuser: "share token",
		verb: "unpause the share token",
		signing: "Signing resumes holder transfers and returns of escrowed shares.",
		done: "Share token unpaused",
		doneBody: "Holder transfers and returns of escrowed shares are open again.",
	},
}

const setterCopy =
	(refuser: AdminCopy["refuser"], subject: string, effect?: string) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: `set the ${subject.toLowerCase()}`,
		signing: `New ${subject.toLowerCase()}: ${value}.`,
		done: `${subject} updated`,
		doneBody: effect ?? `${subject}: ${value}.`,
	})

const capitalize = (text: string): string =>
	`${text.charAt(0).toUpperCase()}${text.slice(1)}`

type TimelockRefuser = Extract<
	AdminCopy["refuser"],
	"vault" | "share token" | "oracle"
>

const WAITS: Record<TimelockRefuser, string> = {
	vault: "the upgrade delay",
	"share token": "the vault's upgrade delay",
	oracle: "the vault's upgrade delay",
}

const proposeCopy =
	(refuser: TimelockRefuser, verb: string, subject: string) =>
	(value: string): AdminCopy => ({
		refuser,
		verb,
		signing: `Signing queues ${subject} ${value}.`,
		done: "Change proposed",
		doneBody: `${capitalize(subject)} ${value} applies once ${WAITS[refuser]} passes.`,
	})

const CONFIGURATION_COPY: Record<
	ConfigurationModalAction,
	(value: string) => AdminCopy
> = {
	"set-deposit-cap": setterCopy("vault", "Deposit cap"),
	"set-custodian": setterCopy("vault", "Custodian", EFFECTS.custodian),
	"set-notice": setterCopy("vault", "Notice", EFFECTS.notice),
	"set-wind-down-delay": setterCopy(
		"vault",
		"Wind-down delay",
		EFFECTS.windDownDelay,
	),
	"propose-custodian": proposeCopy("vault", "propose a custodian", "custodian"),
	"propose-notice": proposeCopy("vault", "propose a notice", "notice"),
	"propose-wind-down-delay": proposeCopy(
		"vault",
		"propose a wind-down delay",
		"wind-down delay",
	),
	"set-oracle-config": () => ({
		refuser: "oracle",
		verb: "set the oracle limits",
		signing: "Signing replaces every oracle limit.",
		done: "Oracle limits updated",
		doneBody: "The new limits are recorded.",
	}),
	"propose-oracle-config": () => ({
		refuser: "oracle",
		verb: "propose oracle limits",
		signing: "Signing queues every new oracle limit.",
		done: "Change proposed",
		doneBody: `The new oracle limits apply once ${WAITS.oracle} passes.`,
	}),
	"set-compliance": setterCopy("share token", "Compliance contract"),
	"propose-compliance": proposeCopy(
		"share token",
		"propose a compliance contract",
		"compliance contract",
	),
	"set-identity-verifier": setterCopy("share token", "Identity verifier"),
	"propose-identity-verifier": proposeCopy(
		"share token",
		"propose an identity verifier",
		"identity verifier",
	),
}

const grantCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "grant a role",
		signing: `Signing grants ${value}.`,
		done: "Role granted",
		doneBody: `Granted ${value}.`,
	})

const revokeCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "revoke a role",
		signing: `Signing revokes ${value}.`,
		done: "Role revoked",
		doneBody: `Revoked ${value}.`,
	})

const handOverCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "hand over the admin",
		signing: "Signing proposes the handover.",
		done: "Handover proposed",
		doneBody: value,
	})

const cancelHandoverCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "cancel the handover",
		signing: `Signing withdraws the offer to ${value}.`,
		done: "Handover cancelled",
		doneBody: `${value} can no longer accept.`,
	})

const acceptAdminCopy = (refuser: AdminCopy["refuser"]) => (): AdminCopy => ({
	refuser,
	verb: "accept the admin role",
	signing: `Signing makes this wallet the ${refuser} admin.`,
	done: "Admin accepted",
	doneBody: `This wallet is now the ${refuser} admin.`,
})

const proposalCopy =
	(refuser: TimelockRefuser) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "propose an upgrade",
		signing: `Signing queues ${value}.`,
		done: "Upgrade proposed",
		doneBody: `${value} can apply once ${WAITS[refuser]} passes.`,
	})

const VAULT_APPLY_REASONS = {
	1000: "The vault is paused; unpause it first.",
	6046: "The vault is winding down, so no change can apply.",
}

const applyChangeCopy =
	(refuser: TimelockRefuser) =>
	(value: string): AdminCopy => ({
		refuser,
		...(refuser === "vault" ? { reasons: VAULT_APPLY_REASONS } : {}),
		verb: "apply the change",
		signing: `Signing applies ${value}.`,
		done: "Change applied",
		doneBody: `Applied ${value}.`,
	})

const cancelChangeCopy =
	(refuser: TimelockRefuser) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "cancel the change",
		signing: `Signing withdraws ${value}.`,
		done: "Change cancelled",
		doneBody: `Withdrew ${value}.`,
	})

const proposeWindDownCopy = (value: string): AdminCopy => ({
	refuser: "vault",
	verb: "propose a wind-down",
	signing: "Signing starts the wind-down countdown.",
	done: "Wind-down proposed",
	doneBody: value,
})

const cancelWindDownCopy = (): AdminCopy => ({
	refuser: "vault",
	verb: "cancel the wind-down",
	signing: "Signing withdraws the wind-down.",
	done: "Wind-down cancelled",
	doneBody: "The vault stays open.",
})

const GOVERNANCE_COPY: Record<
	GovernanceModalAction,
	(value: string) => AdminCopy
> = {
	"grant-vault-role": grantCopy("vault"),
	"revoke-vault-role": revokeCopy("vault"),
	"grant-oracle-role": grantCopy("oracle"),
	"revoke-oracle-role": revokeCopy("oracle"),
	"grant-token-role": grantCopy("share token"),
	"revoke-token-role": revokeCopy("share token"),
	"hand-over-vault-admin": handOverCopy("vault"),
	"cancel-vault-handover": cancelHandoverCopy("vault"),
	"accept-vault-admin": acceptAdminCopy("vault"),
	"hand-over-oracle-admin": handOverCopy("oracle"),
	"cancel-oracle-handover": cancelHandoverCopy("oracle"),
	"accept-oracle-admin": acceptAdminCopy("oracle"),
	"hand-over-token-admin": handOverCopy("share token"),
	"cancel-token-handover": cancelHandoverCopy("share token"),
	"accept-token-admin": acceptAdminCopy("share token"),
	"propose-grant-role": proposeCopy(
		"vault",
		"propose a role grant",
		"the grant of",
	),
	"propose-revoke-role": proposeCopy(
		"vault",
		"propose a role revoke",
		"the revoke of",
	),
	"propose-admin": proposeCopy(
		"vault",
		"propose the hand-over",
		"the hand-over to",
	),
	"propose-token-grant-role": proposeCopy(
		"share token",
		"propose a role grant",
		"the grant of",
	),
	"propose-token-revoke-role": proposeCopy(
		"share token",
		"propose a role revoke",
		"the revoke of",
	),
	"propose-token-admin": proposeCopy(
		"share token",
		"propose the hand-over",
		"the hand-over to",
	),
	"propose-oracle-grant-role": proposeCopy(
		"oracle",
		"propose a role grant",
		"the grant of",
	),
	"propose-oracle-revoke-role": proposeCopy(
		"oracle",
		"propose a role revoke",
		"the revoke of",
	),
	"propose-oracle-admin": proposeCopy(
		"oracle",
		"propose the hand-over",
		"the hand-over to",
	),
	"propose-code-upgrade": proposalCopy("vault"),
	"propose-upgrade-delay": proposalCopy("vault"),
	"propose-oracle-upgrade": proposalCopy("oracle"),
	"apply-change": applyChangeCopy("vault"),
	"cancel-change": cancelChangeCopy("vault"),
	"apply-token-change": applyChangeCopy("share token"),
	"cancel-token-change": cancelChangeCopy("share token"),
	"apply-oracle-change": applyChangeCopy("oracle"),
	"cancel-oracle-change": cancelChangeCopy("oracle"),
	"propose-wind-down": proposeWindDownCopy,
	"cancel-wind-down": cancelWindDownCopy,
}

const COMPLIANCE_COPY: Record<
	ComplianceModalAction,
	(value: string) => AdminCopy
> = {
	"allow-address": (value) => ({
		refuser: "identity verifier",
		verb: "allow the address",
		signing: `Signing adds ${value} to the allowlist.`,
		done: "Address allowed",
		doneBody: `${value} is on the allowlist.`,
	}),
	"disallow-address": (value) => ({
		refuser: "identity verifier",
		verb: "remove the address from the allowlist",
		signing: `Signing removes ${value} from the allowlist.`,
		done: "Removed from the allowlist",
		doneBody: `${value} is off the allowlist.`,
	}),
	"freeze-address": (value) => ({
		refuser: "share token",
		verb: "freeze the address",
		signing: `Signing freezes ${value}.`,
		done: "Address frozen",
		doneBody: `${value} is frozen.`,
	}),
	"unfreeze-address": (value) => ({
		refuser: "share token",
		verb: "unfreeze the address",
		signing: `Signing unfreezes ${value}.`,
		done: "Address unfrozen",
		doneBody: `${value} is no longer frozen.`,
	}),
	"freeze-shares": (value) => ({
		refuser: "share token",
		verb: "freeze shares",
		signing: `Signing freezes ${value}.`,
		done: "Shares frozen",
		doneBody: `Froze ${value}.`,
	}),
	"unfreeze-shares": (value) => ({
		refuser: "share token",
		verb: "unfreeze shares",
		signing: `Signing unfreezes ${value}.`,
		done: "Shares unfrozen",
		doneBody: `Unfroze ${value}.`,
	}),
	"force-transfer": (value) => ({
		refuser: "share token",
		verb: "force a transfer",
		signing: `Signing moves ${value}.`,
		done: "Transfer forced",
		doneBody: `Moved ${value}.`,
	}),
}

const verbsOf = <Id extends string>(
	table: Record<Id, AdminCopy | ((value: string) => AdminCopy)>,
): Record<Id, string> =>
	Object.fromEntries(
		Object.entries<AdminCopy | ((value: string) => AdminCopy)>(table).map(
			([id, copy]) => [id, (typeof copy === "function" ? copy("") : copy).verb],
		),
	) as Record<Id, string>

export const ADMIN_VERBS: Record<AdminModalAction, string> = {
	...verbsOf(EMERGENCY_COPY),
	...verbsOf(CONFIGURATION_COPY),
	...verbsOf(GOVERNANCE_COPY),
	...verbsOf(COMPLIANCE_COPY),
}

const adminContractErrorReason =
	(refuser: AdminCopy["refuser"]) =>
	(code: number): string => {
		switch (code) {
			case 1000:
				return `The ${refuser} is already paused.`
			case 1001:
				return `The ${refuser} is not paused, so there is nothing to unpause.`
			case 300:
				return "The address does not hold enough shares."
			case 301:
				return "The amount cannot be negative."
			case 303:
				return "The address does not have that many frozen shares."
			case 2000:
				return "This wallet does not hold the role this action needs."
			case 2001:
				return `The ${refuser} has no admin.`
			case 2002:
				return "The role's holders changed before this was recorded."
			case 2007:
				return "The account does not hold this role."
			case 2010:
				return `The ${refuser} already has the maximum number of roles.`
			case 2200:
				return "There is no pending handover."
			case 2201:
				return "The expiry is outside what the network allows."
			case 2202:
				return "The pending handover is to a different address."
			case 2203:
				return "The handover expired before it was accepted."
			case 6046:
				return "The wind-down is already active."
			case 6047:
				return "No wind-down is proposed."
			case 6048:
				return "A wind-down is already proposed."
			case 6055:
				return "A code change is already pending; one at a time."
			case 6056:
				return "There is no pending change with that id."
			case 6057:
				return "The change's delay has not passed yet."
			case 6058:
				return "The upgrade delay cannot be under 7 days."
			case 6059:
				return "The upgrade delay cannot be under the notice."
			case 6060:
				return "The upgrade delay cannot exceed 90 days."
			case 6063:
				return "There are already 16 pending changes; apply or cancel one first."
			case 6064:
				return "Setup is still open, so no change can be proposed yet."
			case 6065:
				return "After setup this change goes through the timelock."
			case 6069:
				return "The wind-down delay cannot be under 7 days."
			case 6075:
				return "The custodian cannot be the vault itself."
			case 3001:
				return "One of the oracle limits is out of range."
			case 3008:
				return "The NAV is not paused, so the latest price cannot be cleared."
			case 3011:
				return "There is no pending change with that id."
			case 3012:
				return "The change's delay has not passed yet."
			case 3013:
				return "There are already 16 pending changes; apply or cancel one first."
			case 3014:
				return "Setup is still open, so no change can be proposed yet."
			case 3015:
				return "After setup this change goes through the timelock."
			case 3016:
				return "The oracle's setup has already finished."
			case 3017:
				return "The oracle is not bound to a vault yet."
			case 3018:
				return "The vault is winding down, so no change can be proposed or applied."
			case 3019:
				return "The vault is paused, which holds every oracle change; unpause it first."
			case 3020:
				return "The change's delay is shorter than the vault's notice now, so it cannot apply."
			case 3021:
				return "A code upgrade is already pending; cancel it first."
			case 6007:
				return "The deposit cap cannot be negative."
			case 6045:
				return "The notice cannot exceed 30 days."
			case 6053:
				return "The wind-down delay cannot exceed 90 days."
			case 6061:
				return "The notice cannot exceed the upgrade delay."
			case 7001:
				return "There is no pending change with that id."
			case 7002:
				return "The change's delay has not passed yet."
			case 7003:
				return "There are already 16 pending changes; apply or cancel one first."
			case 7004:
				return "Setup is still open, so no change can be proposed yet."
			case 7005:
				return "After setup this change goes through the timelock."
			case 7008:
				return "The vault is winding down, so no change can be proposed or applied."
			case 7009:
				return "The vault is paused, which holds every share-token change; unpause it first."
			case 7011:
				return "A code upgrade is already pending; cancel it first."
			case 7016:
				return "An admin hand-over is still pending; cancel it first."
			default:
				return `The ${refuser} refused this request. Try again, and contact support if it keeps happening.`
		}
	}

const describeAdminStatus = (
	copy: AdminCopy,
	status: TransactionStatus,
	followUp: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing to ${copy.verb}`,
				body: "We are getting it ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return { heading: "Confirm in your wallet", body: copy.signing }
		case "submitted":
			return {
				heading: "Sending",
				body: "It is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "shared":
			return {
				heading: describeStanding(status.standing),
				body: describeShared(status.expiresAt),
			}
		case "confirmed":
			return { heading: copy.done, body: copy.doneBody, hash: status.hash }
		case "failed":
			return {
				...describeFailure(
					status.failure,
					(code) =>
						copy.reasons?.[code] ??
						adminContractErrorReason(copy.refuser)(code),
					followUp,
					copy.refuser,
				),
				hash: status.hash,
			}
	}
}

const describeStatus = (
	props: TransactionModalProps,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (props.action) {
		case "subscribe":
			return describeSubscribeStatus(props.status, props.amount, props.ticker)
		case "cancel":
			return describeCancelStatus(props.status, props.amount, props.ticker)
		case "cancel-redeem":
			return describeCancelRedeemStatus(
				props.status,
				props.amount,
				props.ticker,
				props.assetTicker,
			)
		case "claim":
			return describeClaimStatus(
				props.status,
				props.amount,
				props.ticker,
				props.shareTicker,
			)
		case "redeem":
			return describeRedeemStatus(props.status, props.amount, props.ticker)
		case "claim-redeem":
			return describeClaimRedeemStatus(
				props.status,
				props.amount,
				props.ticker,
				props.uncovered,
			)
		case "close-epoch":
			return describeCloseEpochStatus(props.status, props.epoch)
		case "fulfill-epoch":
			return describeFulfillEpochStatus(props.status, props.epoch)
		case "attest":
			return describeAttestStatus(props.status, props.price, props.validFor)
		case "deploy":
			return describeDeployStatus(props.status, props.amount)
		case "fund":
			return describeFundStatus(props.status, props.amount)
		case "activate-wind-down":
			return describeActivateWindDownStatus(props.status)
		case "finalize-round":
			return describeFinalizeRoundStatus(props.status, props.round)
		case "pause-vault":
		case "unpause-vault":
		case "pause-nav":
		case "unpause-nav":
		case "clear-latest":
		case "pause-token":
		case "unpause-token":
			return describeAdminStatus(
				EMERGENCY_COPY[props.action],
				props.status,
				EMERGENCY_FOLLOW_UP,
			)
		case "set-deposit-cap":
		case "set-custodian":
		case "set-notice":
		case "set-wind-down-delay":
		case "propose-custodian":
		case "propose-notice":
		case "propose-wind-down-delay":
		case "set-oracle-config":
		case "propose-oracle-config":
		case "set-compliance":
		case "propose-compliance":
		case "set-identity-verifier":
		case "propose-identity-verifier":
			return describeAdminStatus(
				CONFIGURATION_COPY[props.action](props.value),
				props.status,
				CONFIGURATION_FOLLOW_UP,
			)
		case "grant-vault-role":
		case "revoke-vault-role":
		case "grant-oracle-role":
		case "revoke-oracle-role":
		case "grant-token-role":
		case "revoke-token-role":
		case "hand-over-vault-admin":
		case "cancel-vault-handover":
		case "accept-vault-admin":
		case "hand-over-oracle-admin":
		case "cancel-oracle-handover":
		case "accept-oracle-admin":
		case "hand-over-token-admin":
		case "cancel-token-handover":
		case "accept-token-admin":
		case "propose-grant-role":
		case "propose-revoke-role":
		case "propose-admin":
		case "propose-token-grant-role":
		case "propose-token-revoke-role":
		case "propose-token-admin":
		case "propose-code-upgrade":
		case "propose-upgrade-delay":
		case "apply-change":
		case "cancel-change":
		case "apply-token-change":
		case "cancel-token-change":
		case "propose-oracle-grant-role":
		case "propose-oracle-revoke-role":
		case "propose-oracle-admin":
		case "propose-oracle-upgrade":
		case "apply-oracle-change":
		case "cancel-oracle-change":
		case "propose-wind-down":
		case "cancel-wind-down":
			return describeAdminStatus(
				GOVERNANCE_COPY[props.action](props.value),
				props.status,
				GOVERNANCE_FOLLOW_UP,
			)
		case "allow-address":
		case "disallow-address":
		case "freeze-address":
		case "unfreeze-address":
		case "freeze-shares":
		case "unfreeze-shares":
		case "force-transfer":
			return describeAdminStatus(
				COMPLIANCE_COPY[props.action](props.value),
				props.status,
				COMPLIANCE_FOLLOW_UP,
			)
	}
}

type StepId = "signature" | "network" | "recorded"
type StepState = "done" | "current" | "upcoming" | "failed"

const STEP_ORDER: StepId[] = ["signature", "network", "recorded"]

const stepLabel: Record<StepId, string> = {
	signature: "Approved in your wallet",
	network: "Sent to the network",
	recorded: "Recorded",
}

const computeSteps = (
	status:
		| RequestDepositStatus
		| CancelDepositStatus
		| CancelRedeemStatus
		| ClaimDepositStatus
		| RequestRedeemStatus
		| ClaimRedeemStatus
		| CloseEpochStatus
		| FulfillEpochStatus
		| AttestStatus
		| DeployToCustodianStatus
		| FundStatus
		| ActivateWindDownStatus
		| FinalizeWindDownRoundStatus
		| TransactionStatus,
): Record<StepId, StepState> | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				signature: "upcoming",
				network: "upcoming",
				recorded: "upcoming",
			}
		case "awaiting-signature":
			return { signature: "current", network: "upcoming", recorded: "upcoming" }
		case "submitted":
			return { signature: "done", network: "current", recorded: "upcoming" }
		case "shared":
			return { signature: "done", network: "upcoming", recorded: "upcoming" }
		case "confirmed":
			return { signature: "done", network: "done", recorded: "done" }
		case "failed":
			if (status.failure.kind === "unknown" && status.hash !== undefined) {
				return { signature: "done", network: "done", recorded: "failed" }
			}
			if (
				status.failure.kind === "unknown" ||
				status.failure.kind === "network" ||
				status.failure.kind === "stale"
			) {
				return { signature: "done", network: "failed", recorded: "upcoming" }
			}
			return { signature: "failed", network: "upcoming", recorded: "upcoming" }
	}
}

const stepStateClassName: Record<StepState, string | undefined> = {
	done: styles.stepDone,
	current: styles.stepCurrent,
	failed: styles.stepFailed,
	upcoming: styles.stepUpcoming,
}

const stepAnnouncement: Partial<Record<StepState, string>> = {
	done: "done",
	current: "in progress",
	failed: "failed",
}

export const ShareLink: React.FC<{ xdr: string }> = ({ xdr }) => {
	const [copied, setCopied] = React.useState(false)
	const link = `${window.location.origin}/sign#${xdr}`

	React.useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 2000)
		return () => clearTimeout(timer)
	}, [copied])

	return (
		<div className={styles.link}>
			<input
				className={`${typeStyles.railValue} ${styles.linkInput}`}
				type="text"
				readOnly
				value={link}
				aria-label="Signing link"
				onFocus={(event) => event.currentTarget.select()}
			/>
			<button
				type="button"
				className={styles.retry}
				onClick={() => {
					void navigator.clipboard.writeText(link).then(
						() => setCopied(true),
						() => setCopied(false),
					)
				}}
			>
				{copied ? "Copied" : "Copy link"}
			</button>
		</div>
	)
}

const TransactionModal: React.FC<TransactionModalProps> = (props) => {
	const { status, onClose, onRetry } = props
	const dialogRef = React.useRef<HTMLDialogElement>(null)

	React.useEffect(() => {
		if (dialogRef.current !== null && !dialogRef.current.open) {
			dialogRef.current.showModal()
		}
	}, [])

	const contractErrorCode =
		status.status === "failed" && status.failure.kind === "contract-error"
			? status.failure.code
			: undefined

	React.useEffect(() => {
		if (contractErrorCode !== undefined) {
			console.error(`Contract error ${contractErrorCode}`)
		}
	}, [contractErrorCode])

	const content = describeStatus(props)
	if (content === undefined) return null

	const steps = computeSteps(status)
	const isConfirmed = status.status === "confirmed"
	const explorer =
		content.hash === undefined ? null : explorerTransaction(content.hash)
	const offersRetry =
		status.status === "failed" &&
		(status.failure.kind === "declined" ||
			status.failure.kind === "unsigned" ||
			status.failure.kind === "stale")
	const headingId = "transaction-modal-heading"

	const headingClassName = isConfirmed
		? `${typeStyles.vaultName} ${styles.heading} ${styles.headingConfirmed}`
		: `${typeStyles.sectionHead} ${styles.heading}`

	const body = (
		<>
			<h2 id={headingId} className={headingClassName}>
				{content.heading}
			</h2>
			<p className={`${typeStyles.body} ${styles.body}`}>{content.body}</p>
			{content.hash !== undefined && (
				<p className={`${typeStyles.railValue} ${styles.hash}`}>
					Transaction{" "}
					{explorer === null ? (
						shortAddress(content.hash)
					) : (
						<a
							className={styles.hashLink}
							href={explorer}
							target="_blank"
							rel="noreferrer"
						>
							{shortAddress(content.hash)}
							<ExternalLink className={styles.hashIcon} />
						</a>
					)}
				</p>
			)}
		</>
	)

	return (
		<dialog
			ref={dialogRef}
			aria-modal="true"
			aria-labelledby={headingId}
			className={styles.dialog}
			onCancel={onClose}
		>
			<button
				type="button"
				className={styles.close}
				aria-label="Close"
				onClick={onClose}
			>
				<Close className={styles.closeIcon} />
			</button>
			{steps !== undefined && (
				<ol className={styles.steps} aria-label="Transaction progress">
					{STEP_ORDER.map((id) => {
						const state = steps[id]
						const announcement = stepAnnouncement[state]
						return (
							<li
								key={id}
								className={`${styles.step} ${stepStateClassName[state]}`}
								aria-current={state === "current" ? "step" : undefined}
							>
								<span className={styles.stepMarker} aria-hidden="true" />
								<span className={`${typeStyles.footnote} ${styles.stepLabel}`}>
									{stepLabel[id]}
									{announcement !== undefined && (
										<span className={styles.srOnly}>, {announcement}</span>
									)}
								</span>
							</li>
						)
					})}
				</ol>
			)}
			{isConfirmed ? (
				<div className={styles.arrival} role="status">
					{body}
				</div>
			) : (
				body
			)}
			{status.status === "shared" && <ShareLink xdr={status.xdr} />}
			{offersRetry && (
				<div className={styles.actions}>
					<button type="button" className={styles.retry} onClick={onRetry}>
						Try again
					</button>
				</div>
			)}
		</dialog>
	)
}

export default TransactionModal

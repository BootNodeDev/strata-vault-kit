import { AMOUNT_DECIMALS, formatExact } from "@stellar-scaffold/app-lib"
import { type CancelDepositStatus } from "../../../hooks/useCancelDeposit"
import { type CancelRedeemStatus } from "../../../hooks/useCancelRedeem"
import { type ClaimDepositStatus } from "../../../hooks/useClaimDeposit"
import { type ClaimRedeemStatus } from "../../../hooks/useClaimRedeem"
import { type ClaimWindDownStatus } from "../../../hooks/useClaimWindDown"
import { type RequestDepositStatus } from "../../../hooks/useRequestDeposit"
import { type RequestRedeemStatus } from "../../../hooks/useRequestRedeem"
import { GENERIC_REFUSAL, describeFailure } from "./outcome"

export const NOT_ALLOWLISTED = "Your address is not allowlisted."

const SHARES_NOT_RETURNABLE =
	"Your address cannot receive these shares right now, so they stay with the vault."

const FROZEN = "Your address is frozen."

export const HELD_WHILE_FROZEN = `${FROZEN} This request is held until the freeze is lifted.`

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
		case 6044:
			return "The vault's price feed is not valid right now, so subscriptions are paused until it is."
		case 6076:
			return "The vault does not hold enough to cover its pending deposits right now, so it is not taking new subscriptions until it is funded again."
		case 6068:
			return `${NOT_ALLOWLISTED} Only allowlisted addresses can subscribe.`
		case 6071:
			return `${FROZEN} It cannot subscribe until the freeze is lifted.`
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
		case 6076:
			return "The vault does not hold enough to return this deposit right now. You can cancel once it is funded again."
		case 6071:
			return HELD_WHILE_FROZEN
		default:
			return GENERIC_REFUSAL
	}
}

const cancelRedeemContractErrorReason = (
	code: number,
	assetTicker: string,
): string => {
	const claimInstead = `Once priced, claim the ${assetTicker} it owes you instead.`
	switch (code) {
		case 6068:
			return `${NOT_ALLOWLISTED} These shares cannot come back to you. ${claimInstead}`
		case 6073:
			return `${SHARES_NOT_RETURNABLE} ${claimInstead}`
		default:
			return cancelContractErrorReason(code)
	}
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
		case 6071:
			return HELD_WHILE_FROZEN
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
		case 6064:
			return "The vault's setup is still open. Redemptions start once it closes."
		case 6071:
			return "Your address or some of these shares are frozen. Redeem only your free shares, or wait until the freeze is lifted."
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
		case 6073:
			return `The price left nothing to pay out, so the vault tried to return your shares. ${SHARES_NOT_RETURNABLE}`
		default:
			return claimContractErrorReason(code)
	}
}

const windDownClaimContractErrorReason = (code: number): string => {
	switch (code) {
		case 6051:
			return "The wind-down has not made its first payout yet. Check back once it does."
		case 6054:
			return "You have nothing to claim from the wind-down right now."
		case 6071:
			return HELD_WHILE_FROZEN
		default:
			return GENERIC_REFUSAL
	}
}

export const describeSubscribeStatus = (
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

export const describeCancelStatus = (
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

export const describeCancelRedeemStatus = (
	status: CancelRedeemStatus,
	amount: string,
	ticker: string,
	assetTicker: string,
	windingDown: boolean,
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
				body: windingDown
					? `Your request is withdrawn, not priced. The vault is winding down, so signing moves ${amount} ${ticker} into your wind-down claim instead of your wallet.`
					: `Your request is withdrawn, not priced. Signing returns ${amount} ${ticker} from escrow to your wallet.`,
			}
		case "submitted":
			return {
				heading: "Sending your cancellation",
				body: "Your cancellation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return status.surrendered
				? {
						heading: MOVED_TO_WIND_DOWN,
						body: "The vault is winding down, so these shares were added to your wind-down claim instead of coming back to your wallet.",
						hash: status.hash,
					}
				: {
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

const MOVED_TO_WIND_DOWN = "Moved to your wind-down claim"

const convertedOutcome = (
	queuedInto: bigint,
	ticker: string,
): { heading: string; body: string } =>
	queuedInto === 0n
		? {
				heading: MOVED_TO_WIND_DOWN,
				body: `${NOT_ALLOWLISTED} Your shares were added to your wind-down claim instead.`,
			}
		: {
				heading: "Queued as a redemption",
				body: `${NOT_ALLOWLISTED} Your shares were queued as a redemption instead, and pay out in ${ticker} at the next price.`,
			}

export const describeClaimStatus = (
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
			if (status.queuedInto !== undefined)
				return {
					...convertedOutcome(status.queuedInto, ticker),
					hash: status.hash,
				}
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

export const describeClaimWindDownStatus = (
	status: ClaimWindDownStatus,
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
				body: `You receive ${amount} ${ticker}, your share of the wind-down so far. Signing also turns in your unfrozen ${shareTicker}, so later rounds pay you for them.`,
			}
		case "submitted":
			return {
				heading: "Sending your claim",
				body: "Your claim is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				...windDownClaimOutcome(status, ticker, shareTicker),
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(status.failure, windDownClaimContractErrorReason),
				hash: status.hash,
			}
	}
}

const windDownClaimOutcome = (
	{
		assetsClaimed,
		sharesSurrendered,
	}: Extract<ClaimWindDownStatus, { status: "confirmed" }>,
	ticker: string,
	shareTicker: string,
): { heading: string; body: string } => {
	const turnedIn =
		sharesSurrendered > 0n
			? `${formatExact(sharesSurrendered, AMOUNT_DECIMALS)} ${shareTicker} were turned in, and later rounds pay you for them.`
			: "Later rounds pay what you are owed."
	return assetsClaimed > 0n
		? {
				heading: `${ticker} claimed`,
				body: `${formatExact(assetsClaimed, AMOUNT_DECIMALS)} ${ticker} has been added to your wallet. ${turnedIn}`,
			}
		: {
				heading: "Shares turned in",
				body: `Nothing was paid this time. ${turnedIn}`,
			}
}

export const describeRedeemStatus = (
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

export const describeClaimRedeemStatus = (
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
				: status.sharesReturned
					? {
							heading: "Shares returned",
							body: "The price left nothing to claim, so your shares have been returned to your wallet instead.",
							hash: status.hash,
						}
					: {
							heading: "Nothing to pay out",
							body: "The price left nothing to pay out, and the vault is winding down, so these shares were burned.",
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

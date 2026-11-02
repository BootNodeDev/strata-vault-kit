import {
	AMOUNT_DECIMALS,
	type Amount,
	formatExact,
} from "@stellar-scaffold/app-lib"
import { type ClaimDepositOutcome } from "../../../hooks/useClaimDeposit"
import { type ClaimWindDownStatus } from "../../../hooks/useClaimWindDown"
import { GENERIC_REFUSAL } from "./describe"
import { type Copy, type Reasons, type StatusCopy } from "./types"

export const NOT_ALLOWLISTED = "Your address is not allowlisted."

const SHARES_NOT_RETURNABLE =
	"Your address cannot receive these shares right now, so they stay with the vault."

const FROZEN = "Your address is frozen."

export const HELD_WHILE_FROZEN = `${FROZEN} This request is held until the freeze is lifted.`

const INVESTOR_FOLLOW_UP = "check your requests before doing anything else"

const INVESTOR = {
	followUp: INVESTOR_FOLLOW_UP,
	refuser: "vault",
	fallback: GENERIC_REFUSAL,
}

const MOVED_TO_WIND_DOWN = "Moved to your wind-down claim"

const PREPARING_CANCELLATION: Copy = {
	heading: "Preparing your cancellation",
	body: "We are getting your cancellation ready. Your wallet will ask you to approve it next.",
}

const SENDING_CANCELLATION: Copy = {
	heading: "Sending your cancellation",
	body: "Your cancellation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
}

const PREPARING_CLAIM: Copy = {
	heading: "Preparing your claim",
	body: "We are getting your claim ready. Your wallet will ask you to approve it next.",
}

const SENDING_CLAIM: Copy = {
	heading: "Sending your claim",
	body: "Your claim is on its way to the network. This should only take a moment. Closing this window will not stop it.",
}

const SUBSCRIBE_REASONS: Reasons = {
	InvalidAmount: "Enter an amount greater than zero.",
	RequestOutstanding: "You already have a subscription request open.",
	AmountTooLarge: "That amount is too large for the vault to accept.",
	WindDownActive:
		"The vault is winding down and is not accepting new subscriptions.",
	SetupOpen:
		"The vault's setup is still open. Subscriptions start once it closes.",
	FeedNotValid:
		"The vault's price feed is not valid right now, so subscriptions are paused until it is.",
	EscrowNotCovered:
		"The vault does not hold enough to cover its pending deposits right now, so it is not taking new subscriptions until it is funded again.",
	NotAllowlisted: `${NOT_ALLOWLISTED} Only allowlisted addresses can subscribe.`,
	Frozen: `${FROZEN} It cannot subscribe until the freeze is lifted.`,
}

const CANCEL_REASONS: Reasons = {
	RequestNotFound: "This request no longer exists to cancel.",
	EpochNotFound: "This request could not be found.",
	AlreadyPriced:
		"This request has already been priced. Claim your shares instead of cancelling.",
	PriceAvailable:
		"A price is available, so this request can no longer be cancelled. It will be priced shortly, and your shares are claimable once it is.",
	EscrowNotCovered:
		"The vault does not hold enough to return this deposit right now. You can cancel once it is funded again.",
	Frozen: HELD_WHILE_FROZEN,
}

const cancelRedeemReasons = (assetTicker: string): Reasons => {
	const claimInstead = `Once priced, claim the ${assetTicker} it owes you instead.`
	return {
		...CANCEL_REASONS,
		NotAllowlisted: `${NOT_ALLOWLISTED} These shares cannot come back to you. ${claimInstead}`,
		HolderNotEligible: `${SHARES_NOT_RETURNABLE} ${claimInstead}`,
	}
}

const CLAIM_REASONS: Reasons = {
	RequestNotFound: "You have no request to claim.",
	AmountTooLarge:
		"The share conversion for this claim is too large to complete.",
	EpochNotFound: "This request could not be found.",
	InvalidSharePrice:
		"The vault has not published a valid price for this request yet.",
	AlreadyClaimed: "This request has already been claimed.",
	ClaimNotCovered:
		"The vault does not yet hold enough in reserve to cover this claim. Try again shortly.",
	Frozen: HELD_WHILE_FROZEN,
}

const REDEEM_REASONS: Reasons = {
	InvalidAmount: "Enter an amount greater than zero.",
	RequestOutstanding: "You already have a redemption request open.",
	AmountTooLarge: "That amount is too large for the vault to accept.",
	EpochNotFound: "This request could not be found.",
	WindDownActive:
		"The vault is winding down and is not accepting new redemptions.",
	SetupOpen:
		"The vault's setup is still open. Redemptions start once it closes.",
	Frozen:
		"Your address or some of these shares are frozen. Redeem only your free shares, or wait until the freeze is lifted.",
}

const claimRedeemReasons = (ticker: string, uncovered?: string): Reasons => ({
	...CLAIM_REASONS,
	EpochNotFulfilled:
		"This request has not priced yet. Check back after the vault's next update.",
	ClaimNotCovered:
		uncovered !== undefined
			? `The vault is ${uncovered} short of covering every priced claim. Try again once the reserve catches up.`
			: `The vault does not yet hold enough ${ticker} in reserve to cover this claim. Try again shortly.`,
	HolderNotEligible: `The price left nothing to pay out, so the vault tried to return your shares. ${SHARES_NOT_RETURNABLE}`,
})

const WIND_DOWN_CLAIM_REASONS: Reasons = {
	DistributionNotStarted:
		"The wind-down has not made its first payout yet. Check back once it does.",
	NoEntitlement: "You have nothing to claim from the wind-down right now.",
	Frozen: HELD_WHILE_FROZEN,
}

export const subscribeCopy = (amount: string, ticker: string): StatusCopy => ({
	...INVESTOR,
	reasons: SUBSCRIBE_REASONS,
	preparing: {
		heading: "Preparing your request",
		body: "We are getting your request ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Your shares are set once the vault prices your request, not today. Signing locks ${amount} ${ticker} in escrow until then.`,
	},
	submitted: {
		heading: "Sending your request",
		body: "Your request is on its way to the network. This should only take a moment, while pricing comes later and takes longer. Closing this window will not cancel it.",
	},
	confirmed: () => ({
		heading: "Request submitted",
		body: `${amount} ${ticker} prices at the vault's next update.`,
	}),
})

export const cancelCopy = (
	amount: string,
	ticker: string,
): StatusCopy<{ refundedAmount: Amount }> => ({
	...INVESTOR,
	reasons: CANCEL_REASONS,
	preparing: PREPARING_CANCELLATION,
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Your request is withdrawn, not priced. Signing returns ${amount} ${ticker} from escrow to your wallet.`,
	},
	submitted: SENDING_CANCELLATION,
	confirmed: (status) => ({
		heading: "Request cancelled",
		body: `${formatExact(status.refundedAmount, AMOUNT_DECIMALS)} ${ticker} has been returned to your wallet.`,
	}),
})

export const cancelRedeemCopy = (
	amount: string,
	ticker: string,
	assetTicker: string,
	windingDown: boolean,
): StatusCopy<{ returnedShares: Amount; surrendered: boolean }> => ({
	...INVESTOR,
	reasons: cancelRedeemReasons(assetTicker),
	preparing: PREPARING_CANCELLATION,
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: windingDown
			? `Your request is withdrawn, not priced. The vault is winding down, so signing moves ${amount} ${ticker} into your wind-down claim instead of your wallet.`
			: `Your request is withdrawn, not priced. Signing returns ${amount} ${ticker} from escrow to your wallet.`,
	},
	submitted: SENDING_CANCELLATION,
	confirmed: (status) =>
		status.surrendered
			? {
					heading: MOVED_TO_WIND_DOWN,
					body: "The vault is winding down, so these shares were added to your wind-down claim instead of coming back to your wallet.",
				}
			: {
					heading: "Request cancelled",
					body: `${formatExact(status.returnedShares, AMOUNT_DECIMALS)} ${ticker} has been returned to your wallet.`,
				},
})

const convertedOutcome = (queuedInto: bigint, ticker: string): Copy =>
	queuedInto === 0n
		? {
				heading: MOVED_TO_WIND_DOWN,
				body: `${NOT_ALLOWLISTED} Your shares were added to your wind-down claim instead.`,
			}
		: {
				heading: "Queued as a redemption",
				body: `${NOT_ALLOWLISTED} Your shares were queued as a redemption instead, and pay out in ${ticker} at the next price.`,
			}

export const claimCopy = (
	amount: string,
	ticker: string,
	shareTicker: string,
): StatusCopy<ClaimDepositOutcome> => ({
	...INVESTOR,
	reasons: CLAIM_REASONS,
	preparing: PREPARING_CLAIM,
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `You receive what you're owed. If the price leaves no shares to claim, ${amount} ${ticker} returns to your wallet instead.`,
	},
	submitted: SENDING_CLAIM,
	confirmed: (status) => {
		if (status.queuedInto !== undefined)
			return convertedOutcome(status.queuedInto, ticker)
		return status.sharesMinted > 0n
			? {
					heading: "Shares claimed",
					body: `${formatExact(status.sharesMinted, AMOUNT_DECIMALS)} ${shareTicker} has been added to your wallet.`,
				}
			: {
					heading: "Deposit returned",
					body: `The price left no shares to claim, so ${amount} ${ticker} has been returned to your wallet instead.`,
				}
	},
})

const windDownClaimOutcome = (
	{
		assetsClaimed,
		sharesSurrendered,
	}: Extract<ClaimWindDownStatus, { status: "confirmed" }>,
	ticker: string,
	shareTicker: string,
): Copy => {
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

export const claimWindDownCopy = (
	amount: string,
	ticker: string,
	shareTicker: string,
): StatusCopy<{ assetsClaimed: Amount; sharesSurrendered: Amount }> => ({
	...INVESTOR,
	reasons: WIND_DOWN_CLAIM_REASONS,
	preparing: PREPARING_CLAIM,
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `You receive ${amount} ${ticker}, your share of the wind-down so far. Signing also turns in your unfrozen ${shareTicker}, so later rounds pay you for them.`,
	},
	submitted: SENDING_CLAIM,
	confirmed: (status) => windDownClaimOutcome(status, ticker, shareTicker),
})

export const redeemCopy = (amount: string, ticker: string): StatusCopy => ({
	...INVESTOR,
	reasons: REDEEM_REASONS,
	preparing: {
		heading: "Preparing your redemption request",
		body: "We are getting your redemption request ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `What you're owed is set once the vault prices your request, not today. Signing locks ${amount} ${ticker} in escrow until then.`,
	},
	submitted: {
		heading: "Sending your redemption request",
		body: "Your redemption request is on its way to the network. This should only take a moment, while pricing comes later and takes longer. Closing this window will not cancel it.",
	},
	confirmed: () => ({
		heading: "Redemption request submitted",
		body: `${amount} ${ticker} prices at the vault's next update.`,
	}),
})

export const claimRedeemCopy = (
	amount: string,
	ticker: string,
	uncovered?: string,
): StatusCopy<{ assetsClaimed: Amount; sharesReturned: boolean }> => ({
	...INVESTOR,
	reasons: claimRedeemReasons(ticker, uncovered),
	preparing: PREPARING_CLAIM,
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `You receive what you're owed. Signing sends ${amount} ${ticker} to your wallet.`,
	},
	submitted: SENDING_CLAIM,
	confirmed: (status) => {
		if (status.assetsClaimed > 0n)
			return {
				heading: `${ticker} claimed`,
				body: `${formatExact(status.assetsClaimed, AMOUNT_DECIMALS)} ${ticker} has been added to your wallet.`,
			}
		return status.sharesReturned
			? {
					heading: "Shares returned",
					body: "The price left nothing to claim, so your shares have been returned to your wallet instead.",
				}
			: {
					heading: "Nothing to pay out",
					body: "The price left nothing to pay out, and the vault is winding down, so these shares were burned.",
				}
	},
})

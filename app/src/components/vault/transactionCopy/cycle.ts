import {
	AMOUNT_DECIMALS,
	type Amount,
	formatExact,
	formatScaled,
	type Price,
	PRICE_DECIMALS,
} from "@stellar-scaffold/app-lib"
import { GENERIC_REFUSAL } from "./describe"
import { type Reasons, type StatusCopy } from "./types"

const OPERATOR_FOLLOW_UP = "check the Cycle card before trying again"

const OPERATOR = {
	followUp: OPERATOR_FOLLOW_UP,
	refuser: "vault",
	fallback: GENERIC_REFUSAL,
}

const CLOSE_EPOCH_REASONS: Reasons = {
	WindDownActive: "The vault is winding down, so no more epochs can be sealed.",
	EpochNotFound: "The current epoch could not be found.",
	EpochNotOpen: "The current epoch is not open, so there is nothing to seal.",
	Unauthorized: "This wallet is not authorized to close epochs.",
	RoleNotHeld: "This wallet does not hold the manager role.",
	MinEpochDurationNotElapsed:
		"Only the manager can seal this epoch until it has been open for the minimum duration.",
	SetupOpen: "The vault's setup is still open, so no epoch can be sealed yet.",
}

const FULFILL_EPOCH_REASONS: Reasons = {
	WindDownActive:
		"The vault is winding down, so epochs can no longer be priced.",
	EpochNotFound: "This epoch could not be found.",
	EpochNotPending: "This epoch is not sealed, so it cannot be priced.",
	NoticeNotElapsed: "The notice period has not elapsed yet.",
	FeedNotValid: "The oracle price is not valid right now.",
	AttestationBeforeClose:
		"The latest price was attested before this epoch was sealed. A fresh attestation is needed.",
	InvalidSharePrice: "The vault could not resolve a valid share price.",
	AmountTooLarge: "The settlement total is too large for the vault to record.",
	EnforcedPause: "The vault is paused, so epochs cannot be priced.",
	SetupOpen: "The vault's setup is still open, so no epoch can be priced yet.",
}

const ATTEST_REASONS: Reasons = {
	NavOutOfBand: "That price is outside the band the oracle accepts.",
	ExpiresInPast: "The attestation would already have expired when recorded.",
	CooldownActive:
		"The cooldown since the last attestation has not elapsed yet.",
	DeviationExceeded:
		"That price moves further from the last attested price than the oracle allows.",
	NavPaused: "Unpause the NAV first.",
	EmptyProofHash: "The proof hash cannot be all zeros.",
	ProofUriTooLong: "The proof URI is longer than 256 bytes.",
}

const DEPLOY_REASONS: Reasons = {
	WindDownActive:
		"The vault is winding down, so nothing can leave for the custodian.",
	InvalidAmount: "Enter an amount greater than zero.",
	CustodianNotSet: "No custodian is set, so there is nowhere to deploy to.",
	ReserveCommittedToExits:
		"That amount exceeds the free reserve. The rest is committed to priced exits.",
	AmountTooLarge: "That amount is too large for the vault to record.",
	Unauthorized: "This wallet is not authorized to deploy to the custodian.",
	RoleNotHeld: "This wallet does not hold the treasury role.",
}

const FUND_REASONS: Reasons = {
	InvalidAmount: "Enter an amount greater than zero.",
	AmountTooLarge: "That amount is too large for the vault to record.",
}

const ACTIVATE_WIND_DOWN_REASONS: Reasons = {
	WindDownNotProposed:
		"No wind-down has been proposed, so there is nothing to activate.",
	WindDownActive: "The wind-down is already active.",
	WindDownDelayNotElapsed: "The wind-down delay has not elapsed yet.",
}

const FINALIZE_ROUND_REASONS: Reasons = {
	WindDownNotActive:
		"The wind-down is not active, so no round can be finalized.",
	NothingToDistribute:
		"There is nothing to distribute: the free reserve is empty or too small to split across holders.",
	AmountTooLarge: "The round is too large for the vault to record.",
}

export const closeEpochCopy = (
	epoch: string,
): StatusCopy<{ sealedEpoch: bigint }> => ({
	...OPERATOR,
	reasons: CLOSE_EPOCH_REASONS,
	preparing: {
		heading: `Preparing to close epoch ${epoch}`,
		body: "We are getting the close ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Signing seals epoch ${epoch} and opens the next one. Requests in epoch ${epoch} wait for a price.`,
	},
	submitted: {
		heading: "Sending the close",
		body: "The close is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	confirmed: (status) => ({
		heading: `Epoch ${status.sealedEpoch} sealed`,
		body: `Epoch ${status.sealedEpoch + 1n} is open and accepting requests. Epoch ${status.sealedEpoch} prices once the notice elapses and a valid price is attested.`,
	}),
})

export const fulfillEpochCopy = (
	epoch: string,
): StatusCopy<{ sharePrice: Price }> => ({
	...OPERATOR,
	reasons: FULFILL_EPOCH_REASONS,
	preparing: {
		heading: `Preparing to price epoch ${epoch}`,
		body: "We are getting the settlement ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Signing prices epoch ${epoch} at the oracle's current price and settles its requests.`,
	},
	submitted: {
		heading: "Sending the settlement",
		body: "The settlement is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	confirmed: (status) => ({
		heading: `Epoch ${epoch} priced`,
		body: `Settled at ${formatScaled(status.sharePrice, PRICE_DECIMALS, 4)} per share. Share claims are ready; redemption claims wait until the reserve covers them.`,
	}),
})

export const attestCopy = (
	price: string,
	validFor: string | null,
): StatusCopy => ({
	...OPERATOR,
	reasons: ATTEST_REASONS,
	preparing: {
		heading: `Preparing to attest ${price}`,
		body: "We are getting the attestation ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Signing records ${price} as the share price, with its proof. Sealed epochs settle at it once their notice elapses.`,
	},
	submitted: {
		heading: "Sending the attestation",
		body: "The attestation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	confirmed: () => ({
		heading: "Price attested",
		body:
			validFor === null
				? `${price} is the share price.`
				: `${price} is the share price. Valid for ${validFor}.`,
	}),
})

export const deployCopy = (amount: string): StatusCopy => ({
	...OPERATOR,
	reasons: DEPLOY_REASONS,
	preparing: {
		heading: `Preparing to deploy ${amount}`,
		body: "We are getting the deployment ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Signing sends ${amount} from the vault's reserve to the custodian.`,
	},
	submitted: {
		heading: "Sending the deployment",
		body: "The deployment is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	confirmed: () => ({
		heading: "Deployed",
		body: `${amount} left the vault for the custodian.`,
	}),
})

export const fundCopy = (amount: string): StatusCopy => ({
	...OPERATOR,
	reasons: FUND_REASONS,
	// the asset's transfer errors are the only ones no generated client names
	unnamedFallback:
		"Your wallet could not cover the transfer. Check the balance and the trustline.",
	preparing: {
		heading: `Preparing to fund ${amount}`,
		body: "We are getting the funding ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Signing moves ${amount} from your wallet into the vault's reserve.`,
	},
	submitted: {
		heading: "Sending the funding",
		body: "The funding is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	confirmed: () => ({
		heading: "Funded",
		body: `${amount} joined the reserve.`,
	}),
})

export const activateWindDownCopy = (): StatusCopy => ({
	...OPERATOR,
	reasons: ACTIVATE_WIND_DOWN_REASONS,
	preparing: {
		heading: "Preparing to activate the wind-down",
		body: "We are getting the activation ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: "Signing stops new requests and opens distribution rounds.",
	},
	submitted: {
		heading: "Sending the activation",
		body: "The activation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	confirmed: () => ({
		heading: "Wind-down active",
		body: "New requests are closed. Rounds can now distribute the free reserve.",
	}),
})

export const finalizeRoundCopy = (
	round: string,
): StatusCopy<{ credited: Amount }> => ({
	...OPERATOR,
	reasons: FINALIZE_ROUND_REASONS,
	preparing: {
		heading: `Preparing round ${round}`,
		body: "We are getting the round ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: {
		heading: "Confirm in your wallet",
		body: `Signing distributes the free reserve to holders as round ${round}.`,
	},
	submitted: {
		heading: "Sending the round",
		body: "The round is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	confirmed: (status) => ({
		heading: `Round ${round} finalized`,
		body: `${formatExact(status.credited, AMOUNT_DECIMALS)} is claimable by holders.`,
	}),
})

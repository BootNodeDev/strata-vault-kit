import {
	AMOUNT_DECIMALS,
	formatExact,
	formatScaled,
	PRICE_DECIMALS,
} from "@stellar-scaffold/app-lib"
import { type ActivateWindDownStatus } from "../../../hooks/useActivateWindDown"
import { type AttestStatus } from "../../../hooks/useAttest"
import { type CloseEpochStatus } from "../../../hooks/useCloseEpoch"
import { type DeployToCustodianStatus } from "../../../hooks/useDeployToCustodian"
import { type FinalizeWindDownRoundStatus } from "../../../hooks/useFinalizeWindDownRound"
import { type FulfillEpochStatus } from "../../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../../hooks/useFund"
import { GENERIC_REFUSAL, describeFailure } from "./outcome"

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
		case 6077:
			return "Only the manager can seal this epoch until it has been open for the minimum duration."
		case 6064:
			return "The vault's setup is still open, so no epoch can be sealed yet."
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
		case 6064:
			return "The vault's setup is still open, so no epoch can be priced yet."
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

const OPERATOR_FOLLOW_UP = "check the Cycle card before trying again"
export const describeCloseEpochStatus = (
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

export const describeFulfillEpochStatus = (
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

export const describeAttestStatus = (
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

export const describeDeployStatus = (
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

export const describeFundStatus = (
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

export const describeActivateWindDownStatus = (
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

export const describeFinalizeRoundStatus = (
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

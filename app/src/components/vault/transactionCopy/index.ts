import { ADMIN_COPY } from "./admin"
import {
	activateWindDownCopy,
	attestCopy,
	closeEpochCopy,
	deployCopy,
	finalizeRoundCopy,
	fulfillEpochCopy,
	fundCopy,
} from "./cycle"
import { describeStatus } from "./describe"
import {
	cancelCopy,
	cancelRedeemCopy,
	claimCopy,
	claimRedeemCopy,
	claimWindDownCopy,
	redeemCopy,
	subscribeCopy,
} from "./investor"
import { type Content, type TransactionModalProps } from "./types"

export const describeTransaction = (
	props: TransactionModalProps,
): Content | undefined => {
	switch (props.action) {
		case "subscribe":
			return describeStatus(
				subscribeCopy(props.amount, props.ticker),
				props.status,
			)
		case "cancel":
			return describeStatus(
				cancelCopy(props.amount, props.ticker),
				props.status,
			)
		case "cancel-redeem":
			return describeStatus(
				cancelRedeemCopy(
					props.amount,
					props.ticker,
					props.assetTicker,
					props.windingDown === true,
				),
				props.status,
			)
		case "claim":
			return describeStatus(
				claimCopy(props.amount, props.ticker, props.shareTicker),
				props.status,
			)
		case "redeem":
			return describeStatus(
				redeemCopy(props.amount, props.ticker),
				props.status,
			)
		case "claim-redeem":
			return describeStatus(
				claimRedeemCopy(props.amount, props.ticker, props.uncovered),
				props.status,
			)
		case "claim-wind-down":
			return describeStatus(
				claimWindDownCopy(props.amount, props.ticker, props.shareTicker),
				props.status,
			)
		case "close-epoch":
			return describeStatus(closeEpochCopy(props.epoch), props.status)
		case "fulfill-epoch":
			return describeStatus(fulfillEpochCopy(props.epoch), props.status)
		case "attest":
			return describeStatus(
				attestCopy(props.price, props.validFor),
				props.status,
			)
		case "deploy":
			return describeStatus(deployCopy(props.amount), props.status)
		case "fund":
			return describeStatus(fundCopy(props.amount), props.status)
		case "activate-wind-down":
			return describeStatus(activateWindDownCopy(), props.status)
		case "finalize-round":
			return describeStatus(finalizeRoundCopy(props.round), props.status)
		default:
			return describeStatus(
				ADMIN_COPY[props.action]("value" in props ? props.value : ""),
				props.status,
			)
	}
}

import { type ActivateWindDownStatus } from "../../../hooks/useActivateWindDown"
import { type AttestStatus } from "../../../hooks/useAttest"
import { type CancelDepositStatus } from "../../../hooks/useCancelDeposit"
import { type CancelRedeemStatus } from "../../../hooks/useCancelRedeem"
import { type ClaimDepositStatus } from "../../../hooks/useClaimDeposit"
import { type ClaimRedeemStatus } from "../../../hooks/useClaimRedeem"
import { type CloseEpochStatus } from "../../../hooks/useCloseEpoch"
import { type TransactionStatus } from "../../../hooks/useContractTransaction"
import { type DeployToCustodianStatus } from "../../../hooks/useDeployToCustodian"
import { type FinalizeWindDownRoundStatus } from "../../../hooks/useFinalizeWindDownRound"
import { type FulfillEpochStatus } from "../../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../../hooks/useFund"
import { type RequestDepositStatus } from "../../../hooks/useRequestDeposit"
import { type RequestRedeemStatus } from "../../../hooks/useRequestRedeem"
import styles from "../TransactionModal.module.css"

type StepId = "signature" | "network" | "recorded"
type StepState = "done" | "current" | "upcoming" | "failed"

export const STEP_ORDER: StepId[] = ["signature", "network", "recorded"]

export const stepLabel: Record<StepId, string> = {
	signature: "Approved in your wallet",
	network: "Sent to the network",
	recorded: "Recorded",
}

export const computeSteps = (
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

export const stepStateClassName: Record<StepState, string | undefined> = {
	done: styles.stepDone,
	current: styles.stepCurrent,
	failed: styles.stepFailed,
	upcoming: styles.stepUpcoming,
}

export const stepAnnouncement: Partial<Record<StepState, string>> = {
	done: "done",
	current: "in progress",
	failed: "failed",
}

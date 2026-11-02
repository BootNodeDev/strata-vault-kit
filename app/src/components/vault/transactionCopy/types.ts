import { type ActivateWindDownStatus } from "../../../hooks/useActivateWindDown"
import { type AttestStatus } from "../../../hooks/useAttest"
import { type CancelDepositStatus } from "../../../hooks/useCancelDeposit"
import { type CancelRedeemStatus } from "../../../hooks/useCancelRedeem"
import { type ClaimDepositStatus } from "../../../hooks/useClaimDeposit"
import { type ClaimRedeemStatus } from "../../../hooks/useClaimRedeem"
import { type ClaimWindDownStatus } from "../../../hooks/useClaimWindDown"
import { type CloseEpochStatus } from "../../../hooks/useCloseEpoch"
import {
	type SharedTransaction,
	type TransactionStatus,
} from "../../../hooks/useContractTransaction"
import { type DeployToCustodianStatus } from "../../../hooks/useDeployToCustodian"
import { type FinalizeWindDownRoundStatus } from "../../../hooks/useFinalizeWindDownRound"
import { type FulfillEpochStatus } from "../../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../../hooks/useFund"
import { type RequestDepositStatus } from "../../../hooks/useRequestDeposit"
import { type RequestRedeemStatus } from "../../../hooks/useRequestRedeem"
import { type ComplianceActionId } from "../../../pages/compliance"
import { type GovernanceActionId } from "../../../pages/governance"

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
	| "set-min-epoch-duration"
	| "propose-custodian"
	| "propose-notice"
	| "propose-wind-down-delay"
	| "propose-min-epoch-duration"
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
			windingDown?: boolean
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
			action: "claim-wind-down"
			status: ClaimWindDownStatus
			amount: string
			ticker: string
			shareTicker: string
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

export type Copy = { heading: string; body: string }

export type Content = Copy & { hash?: string }

export type Reasons = Partial<Record<string, string>>

export type StatusCopy<TConfirmed extends object = Record<never, never>> = {
	preparing: Copy
	awaitingSignature: Copy
	submitted: Copy
	confirmed: (
		status: { status: "confirmed"; hash?: string } & TConfirmed,
	) => Copy
	shared?: (status: SharedTransaction) => Copy
	reasons: Reasons
	fallback: string
	unnamedFallback?: string
	followUp: string
	refuser: string
}

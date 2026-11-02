import { render } from "@testing-library/react"
import { vi } from "vitest"
import { type ActivateWindDownStatus } from "../../../hooks/useActivateWindDown"
import { type AttestStatus } from "../../../hooks/useAttest"
import { type CancelDepositStatus } from "../../../hooks/useCancelDeposit"
import { type CancelRedeemStatus } from "../../../hooks/useCancelRedeem"
import { type ClaimDepositStatus } from "../../../hooks/useClaimDeposit"
import { type ClaimRedeemStatus } from "../../../hooks/useClaimRedeem"
import { type ClaimWindDownStatus } from "../../../hooks/useClaimWindDown"
import { type CloseEpochStatus } from "../../../hooks/useCloseEpoch"
import { type TransactionStatus } from "../../../hooks/useContractTransaction"
import { type DeployToCustodianStatus } from "../../../hooks/useDeployToCustodian"
import { type FinalizeWindDownRoundStatus } from "../../../hooks/useFinalizeWindDownRound"
import { type FulfillEpochStatus } from "../../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../../hooks/useFund"
import { type RequestDepositStatus } from "../../../hooks/useRequestDeposit"
import { type RequestRedeemStatus } from "../../../hooks/useRequestRedeem"
import TransactionModal, {
	type ComplianceModalAction,
	type ConfigurationModalAction,
	type EmergencyModalAction,
	type GovernanceModalAction,
} from "../TransactionModal"

export const renderModal = (status: RequestDepositStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="subscribe"
			status={status}
			amount="150.00"
			ticker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderCancelModal = (status: CancelDepositStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="cancel"
			status={status}
			amount="150.00"
			ticker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderCancelRedeemModal = (status: CancelRedeemStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="cancel-redeem"
			status={status}
			amount="100.00"
			ticker="vUSDC"
			assetTicker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderClaimModal = (status: ClaimDepositStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="claim"
			status={status}
			amount="150.00"
			ticker="USDC"
			shareTicker="vUSDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderRedeemModal = (status: RequestRedeemStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="redeem"
			status={status}
			amount="100.00"
			ticker="vUSDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderClaimRedeemModal = (status: ClaimRedeemStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="claim-redeem"
			status={status}
			amount="100.00"
			ticker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderCloseEpochModal = (
	status: CloseEpochStatus,
	epoch = "5",
) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="close-epoch"
			status={status}
			epoch={epoch}
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderFulfillEpochModal = (status: FulfillEpochStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="fulfill-epoch"
			status={status}
			epoch="4"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderAttestModal = (
	status: AttestStatus,
	validFor: string | null = "1d",
) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="attest"
			status={status}
			price="1.0400"
			validFor={validFor}
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderDeployModal = (status: DeployToCustodianStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="deploy"
			status={status}
			amount="250.00"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderFundModal = (status: FundStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="fund"
			status={status}
			amount="100.00"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderActivateModal = (status: ActivateWindDownStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="activate-wind-down"
			status={status}
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderFinalizeModal = (status: FinalizeWindDownRoundStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="finalize-round"
			status={status}
			round="3"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

export const renderEmergencyModal = (
	action: EmergencyModalAction,
	status: TransactionStatus,
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

export const renderConfigurationModal = (
	action: ConfigurationModalAction,
	status: TransactionStatus,
	value = "",
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			value={value}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

export const renderGovernanceModal = (
	action: GovernanceModalAction,
	status: TransactionStatus,
	value = "Manager to GABC...WXYZ",
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			value={value}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

export const renderComplianceModal = (
	action: ComplianceModalAction,
	status: TransactionStatus,
	value = "GABC...WXYZ",
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			value={value}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

export const renderClaimWindDownModal = (status: ClaimWindDownStatus) =>
	render(
		<TransactionModal
			action="claim-wind-down"
			status={status}
			amount="25.00"
			ticker="USDC"
			shareTicker="vUSDC"
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

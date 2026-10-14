import React, { useEffect, useState } from "react"
import { vaultContractId } from "../../config/contracts"
import {
	type AdminAddresses,
	type Grant,
	type RoleHolders,
} from "../../hooks/useAdminAuthority"
import { useGovernanceState } from "../../hooks/useGovernanceState"
import {
	useApplyUpgrade,
	useCancelUpgrade,
	useCancelWindDown,
	useProposeCodeUpgrade,
	useProposeUpgradeDelay,
	useProposeWindDown,
	useAcceptOracleAdmin,
	useAcceptTokenAdmin,
	useAcceptVaultAdmin,
	useCancelOracleHandover,
	useCancelTokenHandover,
	useCancelVaultHandover,
	useGrantOracleRole,
	useGrantTokenRole,
	useGrantVaultRole,
	useHandOverOracleAdmin,
	useHandOverTokenAdmin,
	useHandOverVaultAdmin,
	useRevokeOracleRole,
	useRevokeTokenRole,
	useRevokeVaultRole,
} from "../../hooks/useGovernanceTransactions"
import {
	usePendingTransaction,
	type UsePendingTransaction,
} from "../../hooks/usePendingTransaction"
import {
	GOVERNANCE_ACTION_IDS,
	type GovernanceAction,
	type GovernanceInputs,
	toGovernanceActions,
	toGovernanceGroups,
} from "../../pages/governance"
import typeStyles from "../../styles/type.module.css"
import MetricsStrip from "../vault/MetricsStrip"
import TransactionModal, {
	type GovernanceModalAction,
	type TransactionModalProps,
} from "../vault/TransactionModal"
import CycleActionRail from "./CycleActionRail"
import SurfaceLayout from "./SurfaceLayout"
import layoutStyles from "./SurfaceLayout.module.css"

type Flow = Pick<
	UsePendingTransaction<never, object>,
	"status" | "amountLabel" | "reset" | "retry" | "submit"
>

const flow = (
	action: GovernanceModalAction,
	transaction: Flow,
): TransactionModalProps => ({
	action,
	status: transaction.status,
	value: transaction.amountLabel,
	onClose: transaction.reset,
	onRetry: transaction.retry,
})

function useGovernanceFlows() {
	return {
		"grant-vault-role": usePendingTransaction(useGrantVaultRole()),
		"revoke-vault-role": usePendingTransaction(useRevokeVaultRole()),
		"hand-over-vault-admin": usePendingTransaction(useHandOverVaultAdmin()),
		"cancel-vault-handover": usePendingTransaction(useCancelVaultHandover()),
		"accept-vault-admin": usePendingTransaction(useAcceptVaultAdmin()),
		"grant-oracle-role": usePendingTransaction(useGrantOracleRole()),
		"revoke-oracle-role": usePendingTransaction(useRevokeOracleRole()),
		"hand-over-oracle-admin": usePendingTransaction(useHandOverOracleAdmin()),
		"cancel-oracle-handover": usePendingTransaction(useCancelOracleHandover()),
		"accept-oracle-admin": usePendingTransaction(useAcceptOracleAdmin()),
		"grant-token-role": usePendingTransaction(useGrantTokenRole()),
		"revoke-token-role": usePendingTransaction(useRevokeTokenRole()),
		"hand-over-token-admin": usePendingTransaction(useHandOverTokenAdmin()),
		"cancel-token-handover": usePendingTransaction(useCancelTokenHandover()),
		"accept-token-admin": usePendingTransaction(useAcceptTokenAdmin()),
		"propose-code-upgrade": usePendingTransaction(useProposeCodeUpgrade()),
		"propose-upgrade-delay": usePendingTransaction(useProposeUpgradeDelay()),
		"apply-upgrade": usePendingTransaction(useApplyUpgrade()),
		"cancel-upgrade": usePendingTransaction(useCancelUpgrade()),
		"propose-wind-down": usePendingTransaction(useProposeWindDown()),
		"cancel-wind-down": usePendingTransaction(useCancelWindDown()),
	} satisfies Record<GovernanceModalAction, Flow>
}

type Flows = ReturnType<typeof useGovernanceFlows>

function submit(flows: Flows, action: GovernanceAction) {
	switch (action.id) {
		case "grant-vault-role":
		case "revoke-vault-role":
		case "grant-oracle-role":
		case "revoke-oracle-role":
		case "grant-token-role":
		case "revoke-token-role":
			return (
				action.arg !== undefined &&
				flows[action.id].submit(action.arg, action.next)
			)
		case "hand-over-vault-admin":
		case "cancel-vault-handover":
		case "hand-over-oracle-admin":
		case "cancel-oracle-handover":
		case "hand-over-token-admin":
		case "cancel-token-handover":
			return (
				action.arg !== undefined &&
				flows[action.id].submit(action.arg, action.next)
			)
		case "propose-code-upgrade":
			return (
				action.arg !== undefined &&
				flows[action.id].submit(action.arg, action.next)
			)
		case "propose-upgrade-delay":
			return (
				action.arg !== undefined &&
				flows[action.id].submit(action.arg, action.next)
			)
		case "accept-vault-admin":
		case "accept-oracle-admin":
		case "accept-token-admin":
		case "apply-upgrade":
		case "cancel-upgrade":
		case "propose-wind-down":
		case "cancel-wind-down":
			return flows[action.id].submit(undefined, action.next)
	}
}

const GovernanceSection: React.FC<{
	grants: Grant[]
	wallet: string
	holders: RoleHolders
	addresses: AdminAddresses
	contracts?: React.ReactNode
	active?: boolean
}> = ({ grants, wallet, holders, addresses, contracts, active = true }) => {
	const { handovers, upgrades } = useGovernanceState({
		contracts:
			addresses.oracle === null || addresses.shareToken === null
				? undefined
				: {
						vault: vaultContractId,
						oracle: addresses.oracle,
						token: addresses.shareToken,
					},
		active,
	})
	const flows = useGovernanceFlows()
	const [inputs, setInputs] = useState<GovernanceInputs>({})

	const modalFlows = GOVERNANCE_ACTION_IDS.map((id) => flow(id, flows[id]))
	const recorded = modalFlows.some(
		(props) => props.status.status === "confirmed",
	)
	useEffect(() => {
		if (recorded) setInputs({})
	}, [recorded])

	const state = { holders, vault: vaultContractId, handovers, upgrades }
	const actions = toGovernanceActions(state, grants, wallet, inputs)

	const onInput = (_: GovernanceAction, value: string, key?: string) => {
		if (key !== undefined)
			setInputs((previous) => ({ ...previous, [key]: value }))
	}

	const activeModal = modalFlows.find((props) => props.status.status !== "idle")

	return (
		<>
			<SurfaceLayout
				side={
					<CycleActionRail
						scope="governance"
						actions={actions}
						pending={false}
						unreadable={false}
						onRun={(action) => submit(flows, action)}
						onInput={onInput}
					/>
				}
			>
				{toGovernanceGroups(state).map((group, index) => {
					const headingId = `governance-group-${index}`
					return (
						<section
							key={group.title}
							className={layoutStyles.group}
							aria-labelledby={headingId}
						>
							<h3
								id={headingId}
								className={`${typeStyles.body} ${layoutStyles.groupTitle}`}
							>
								{group.title}
							</h3>
							<MetricsStrip metrics={group.metrics} />
						</section>
					)
				})}
				{contracts}
			</SurfaceLayout>
			{active && activeModal !== undefined && (
				<TransactionModal {...activeModal} />
			)}
		</>
	)
}

export default GovernanceSection

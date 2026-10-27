import React, { useEffect } from "react"
import { vaultContractId } from "../../config/contracts"
import {
	type AdminAddresses,
	type Grant,
	type RoleHolders,
} from "../../hooks/useAdminAuthority"
import { useGovernanceState } from "../../hooks/useGovernanceState"
import {
	useApplyChange,
	useApplyTokenChange,
	useCancelChange,
	useCancelTokenChange,
	useCancelWindDown,
	useProposeAdmin,
	useProposeCodeUpgrade,
	useProposeGrantRole,
	useProposeRevokeRole,
	useProposeTokenAdmin,
	useProposeTokenGrantRole,
	useProposeTokenRevokeRole,
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
import { useRailInputs } from "../../hooks/useRailInputs"
import {
	GOVERNANCE_ACTION_IDS,
	type GovernanceAction,
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
		"propose-grant-role": usePendingTransaction(useProposeGrantRole()),
		"propose-revoke-role": usePendingTransaction(useProposeRevokeRole()),
		"propose-admin": usePendingTransaction(useProposeAdmin()),
		"propose-code-upgrade": usePendingTransaction(useProposeCodeUpgrade()),
		"propose-upgrade-delay": usePendingTransaction(useProposeUpgradeDelay()),
		"apply-change": usePendingTransaction(useApplyChange()),
		"cancel-change": usePendingTransaction(useCancelChange()),
		"propose-token-grant-role": usePendingTransaction(
			useProposeTokenGrantRole(),
		),
		"propose-token-revoke-role": usePendingTransaction(
			useProposeTokenRevokeRole(),
		),
		"propose-token-admin": usePendingTransaction(useProposeTokenAdmin()),
		"apply-token-change": usePendingTransaction(useApplyTokenChange()),
		"cancel-token-change": usePendingTransaction(useCancelTokenChange()),
		"propose-wind-down": usePendingTransaction(useProposeWindDown()),
		"cancel-wind-down": usePendingTransaction(useCancelWindDown()),
	} satisfies Record<GovernanceModalAction, Flow>
}

type Flows = ReturnType<typeof useGovernanceFlows>

const submitArg = <Arg,>(
	{ submit }: { submit: (arg: Arg, label: string, grant?: Grant) => boolean },
	{ arg, next, grant }: { arg: Arg | undefined; next: string; grant?: Grant },
) => arg !== undefined && submit(arg, next, grant)

function submit(flows: Flows, action: GovernanceAction) {
	switch (action.id) {
		case "grant-vault-role":
		case "revoke-vault-role":
		case "grant-oracle-role":
		case "revoke-oracle-role":
		case "grant-token-role":
		case "revoke-token-role":
		case "propose-grant-role":
		case "propose-revoke-role":
		case "propose-token-grant-role":
		case "propose-token-revoke-role":
			return submitArg(flows[action.id], action)
		case "hand-over-vault-admin":
		case "cancel-vault-handover":
		case "hand-over-oracle-admin":
		case "cancel-oracle-handover":
		case "hand-over-token-admin":
		case "cancel-token-handover":
			return submitArg(flows[action.id], action)
		case "propose-code-upgrade":
		case "propose-admin":
		case "propose-token-admin":
			return submitArg(flows[action.id], action)
		case "propose-upgrade-delay":
			return submitArg(flows[action.id], action)
		case "apply-change":
		case "cancel-change":
		case "apply-token-change":
		case "cancel-token-change":
			return submitArg(flows[action.id], action)
		case "accept-vault-admin":
		case "accept-oracle-admin":
		case "accept-token-admin":
		case "propose-wind-down":
		case "cancel-wind-down":
			return flows[action.id].submit(undefined, action.next, action.grant)
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
	})
	const flows = useGovernanceFlows()
	const { inputs, setInputs, onInput } = useRailInputs()

	const modalFlows = GOVERNANCE_ACTION_IDS.map((id) => flow(id, flows[id]))
	const recorded = modalFlows.some(
		(props) => props.status.status === "confirmed",
	)
	useEffect(() => {
		if (recorded) setInputs({})
	}, [recorded, setInputs])

	const state = { holders, vault: vaultContractId, handovers, upgrades }
	const actions = toGovernanceActions(state, grants, wallet, inputs)

	const activeModal = modalFlows.find((props) => props.status.status !== "idle")

	return (
		<>
			<SurfaceLayout
				side={
					<CycleActionRail
						scope="governance"
						actions={actions}
						pending={handovers.status === "checking"}
						unreadable={handovers.status === "unreadable"}
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

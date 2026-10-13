import React, { useEffect, useState } from "react"
import { vaultContractId } from "../../config/contracts"
import { type Grant, type RoleHolders } from "../../hooks/useAdminAuthority"
import {
	useGrantOracleRole,
	useGrantTokenRole,
	useGrantVaultRole,
	useRevokeOracleRole,
	useRevokeTokenRole,
	useRevokeVaultRole,
} from "../../hooks/useGovernanceTransactions"
import {
	usePendingTransaction,
	type UsePendingTransaction,
} from "../../hooks/usePendingTransaction"
import {
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

const GovernanceSection: React.FC<{
	grants: Grant[]
	wallet: string
	holders: RoleHolders
	contracts?: React.ReactNode
	active?: boolean
}> = ({ grants, wallet, holders, contracts, active = true }) => {
	const grantVault = usePendingTransaction(useGrantVaultRole())
	const revokeVault = usePendingTransaction(useRevokeVaultRole())
	const grantOracle = usePendingTransaction(useGrantOracleRole())
	const revokeOracle = usePendingTransaction(useRevokeOracleRole())
	const grantToken = usePendingTransaction(useGrantTokenRole())
	const revokeToken = usePendingTransaction(useRevokeTokenRole())
	const [inputs, setInputs] = useState<GovernanceInputs>({})

	const modalFlows = (
		[
			["grant-vault-role", grantVault],
			["revoke-vault-role", revokeVault],
			["grant-oracle-role", grantOracle],
			["revoke-oracle-role", revokeOracle],
			["grant-token-role", grantToken],
			["revoke-token-role", revokeToken],
		] satisfies [GovernanceModalAction, Flow][]
	).map(([id, transaction]) => flow(id, transaction))
	const recorded = modalFlows.some(
		(props) => props.status.status === "confirmed",
	)
	useEffect(() => {
		if (recorded) setInputs({})
	}, [recorded])

	const state = { holders, vault: vaultContractId }
	const actions = toGovernanceActions(state, grants, wallet, inputs)

	const run = (action: GovernanceAction) => {
		if (action.arg === undefined) return
		switch (action.id) {
			case "grant-vault-role":
				return grantVault.submit(action.arg, action.next)
			case "revoke-vault-role":
				return revokeVault.submit(action.arg, action.next)
			case "grant-oracle-role":
				return grantOracle.submit(action.arg, action.next)
			case "revoke-oracle-role":
				return revokeOracle.submit(action.arg, action.next)
			case "grant-token-role":
				return grantToken.submit(action.arg, action.next)
			case "revoke-token-role":
				return revokeToken.submit(action.arg, action.next)
		}
	}

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
						onRun={run}
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

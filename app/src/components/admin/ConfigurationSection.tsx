import React, { useEffect, useState } from "react"
import { type Grant } from "../../hooks/useAdminAuthority"
import { useConfigurationState } from "../../hooks/useConfigurationState"
import {
	useSetCompliance,
	useSetCustodian,
	useSetDepositCap,
	useSetIdentityVerifier,
	useSetNotice,
	useSetOracleConfig,
	useSetWindDownDelay,
} from "../../hooks/useConfigurationTransactions"
import {
	usePendingTransaction,
	type UsePendingTransaction,
} from "../../hooks/usePendingTransaction"
import {
	type ConfigurationAction,
	type ConfigurationInputs,
	toConfigurationActions,
	toConfigurationGroups,
} from "../../pages/configuration"
import typeStyles from "../../styles/type.module.css"
import AddressRows from "../vault/AddressRows"
import MetricsStrip from "../vault/MetricsStrip"
import TransactionModal, {
	type ConfigurationModalAction,
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
	action: ConfigurationModalAction,
	transaction: Flow,
): TransactionModalProps => ({
	action,
	status: transaction.status,
	value: transaction.amountLabel,
	onClose: transaction.reset,
	onRetry: transaction.retry,
})

const ConfigurationSection: React.FC<{
	grants: Grant[]
	wallet: string
	contracts?: React.ReactNode
	active?: boolean
}> = ({ grants, wallet, contracts, active = true }) => {
	const { configuration } = useConfigurationState({ active })
	const depositCap = usePendingTransaction(useSetDepositCap())
	const custodian = usePendingTransaction(useSetCustodian())
	const notice = usePendingTransaction(useSetNotice())
	const windDownDelay = usePendingTransaction(useSetWindDownDelay())
	const oracleConfig = usePendingTransaction(useSetOracleConfig())
	const compliance = usePendingTransaction(useSetCompliance())
	const identityVerifier = usePendingTransaction(useSetIdentityVerifier())
	const [inputs, setInputs] = useState<ConfigurationInputs>({})

	const modalFlows = (
		[
			["set-deposit-cap", depositCap],
			["set-custodian", custodian],
			["set-notice", notice],
			["set-wind-down-delay", windDownDelay],
			["set-oracle-config", oracleConfig],
			["set-compliance", compliance],
			["set-identity-verifier", identityVerifier],
		] satisfies [ConfigurationModalAction, Flow][]
	).map(([id, transaction]) => flow(id, transaction))
	const recorded = modalFlows.some(
		(props) => props.status.status === "confirmed",
	)
	useEffect(() => {
		if (recorded) setInputs({})
	}, [recorded])

	const actions = toConfigurationActions(configuration, grants, wallet, inputs)

	const run = (action: ConfigurationAction) => {
		if (action.arg === undefined) return
		switch (action.id) {
			case "set-deposit-cap":
				return depositCap.submit(action.arg, action.next, action.grant)
			case "set-custodian":
				return custodian.submit(action.arg, action.next, action.grant)
			case "set-notice":
				return notice.submit(action.arg, action.next, action.grant)
			case "set-wind-down-delay":
				return windDownDelay.submit(action.arg, action.next, action.grant)
			case "set-oracle-config":
				return oracleConfig.submit(action.arg, action.next, action.grant)
			case "set-compliance":
				return compliance.submit(action.arg, action.next, action.grant)
			case "set-identity-verifier":
				return identityVerifier.submit(action.arg, action.next, action.grant)
		}
	}

	const onInput = (_: ConfigurationAction, value: string, key?: string) => {
		if (key !== undefined)
			setInputs((previous) => ({ ...previous, [key]: value }))
	}

	const activeModal = modalFlows.find((props) => props.status.status !== "idle")

	return (
		<>
			<SurfaceLayout
				side={
					<CycleActionRail
						scope="configuration"
						actions={actions}
						pending={configuration.status === "checking"}
						unreadable={false}
						onRun={run}
						onInput={onInput}
					/>
				}
			>
				{toConfigurationGroups(configuration).map((group, index) => {
					const headingId = `configuration-group-${index}`
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
							{group.strips.map((strip) => (
								<MetricsStrip
									key={strip[0]?.label ?? group.title}
									metrics={strip}
								/>
							))}
							{group.addresses.length > 0 && (
								<AddressRows rows={group.addresses} />
							)}
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

export default ConfigurationSection

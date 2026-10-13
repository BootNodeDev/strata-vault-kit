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
	"status" | "amountLabel" | "reset" | "retry"
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

	const modalFlows: TransactionModalProps[] = [
		flow("set-deposit-cap", depositCap),
		flow("set-custodian", custodian),
		flow("set-notice", notice),
		flow("set-wind-down-delay", windDownDelay),
		flow("set-oracle-config", oracleConfig),
		flow("set-compliance", compliance),
		flow("set-identity-verifier", identityVerifier),
	]
	const recorded = modalFlows.some(
		(props) => props.status.status === "confirmed",
	)
	useEffect(() => {
		if (recorded) setInputs({})
	}, [recorded])

	const actions = toConfigurationActions(configuration, grants, wallet, inputs)

	const run = (action: ConfigurationAction) => {
		switch (action.id) {
			case "set-deposit-cap":
				if (action.arg !== undefined) depositCap.submit(action.arg, action.next)
				return
			case "set-custodian":
				if (action.arg !== undefined) custodian.submit(action.arg, action.next)
				return
			case "set-notice":
				if (action.arg !== undefined) notice.submit(action.arg, action.next)
				return
			case "set-wind-down-delay":
				if (action.arg !== undefined)
					windDownDelay.submit(action.arg, action.next)
				return
			case "set-oracle-config":
				if (action.arg !== undefined)
					oracleConfig.submit(action.arg, action.next)
				return
			case "set-compliance":
				if (action.arg !== undefined) compliance.submit(action.arg, action.next)
				return
			case "set-identity-verifier":
				if (action.arg !== undefined)
					identityVerifier.submit(action.arg, action.next)
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

import React, { useEffect, useState } from "react"
import { vaultContractId } from "../../config/contracts"
import { type AdminAddresses, type Grant } from "../../hooks/useAdminAuthority"
import { useComplianceState } from "../../hooks/useComplianceState"
import {
	useAllowAddress,
	useDisallowAddress,
	useForceTransfer,
	useFreezeAddress,
	useFreezeShares,
	useUnfreezeAddress,
	useUnfreezeShares,
} from "../../hooks/useComplianceTransactions"
import {
	usePendingTransaction,
	type UsePendingTransaction,
} from "../../hooks/usePendingTransaction"
import { confirmKey, type Inputs, parseAccount } from "../../pages/actions"
import {
	COMPLIANCE_ACTION_IDS,
	type ComplianceAction,
	destinationOf,
	toComplianceActions,
	toComplianceTiles,
} from "../../pages/compliance"
import typeStyles from "../../styles/type.module.css"
import MetricsStrip from "../vault/MetricsStrip"
import TransactionModal, {
	type ComplianceModalAction,
	type TransactionModalProps,
} from "../vault/TransactionModal"
import styles from "./ComplianceSection.module.css"
import CycleActionRail from "./CycleActionRail"
import SurfaceLayout from "./SurfaceLayout"
import layoutStyles from "./SurfaceLayout.module.css"

type Flow = Pick<
	UsePendingTransaction<never, object>,
	"status" | "amountLabel" | "reset" | "retry"
>

const flow = (
	action: ComplianceModalAction,
	transaction: Flow,
): TransactionModalProps => ({
	action,
	status: transaction.status,
	value: transaction.amountLabel,
	onClose: transaction.reset,
	onRetry: transaction.retry,
})

function useComplianceFlows() {
	return {
		"allow-address": usePendingTransaction(useAllowAddress()),
		"disallow-address": usePendingTransaction(useDisallowAddress()),
		"freeze-address": usePendingTransaction(useFreezeAddress()),
		"unfreeze-address": usePendingTransaction(useUnfreezeAddress()),
		"freeze-shares": usePendingTransaction(useFreezeShares()),
		"unfreeze-shares": usePendingTransaction(useUnfreezeShares()),
		"force-transfer": usePendingTransaction(useForceTransfer()),
	} satisfies Record<ComplianceModalAction, Flow>
}

type Flows = ReturnType<typeof useComplianceFlows>

const submitArg = <Arg,>(
	{ submit }: { submit: (arg: Arg, label: string) => boolean },
	{ arg, next }: { arg: Arg | undefined; next: string },
) => arg !== undefined && submit(arg, next)

function submit(flows: Flows, action: ComplianceAction) {
	switch (action.id) {
		case "allow-address":
		case "disallow-address":
			return submitArg(flows[action.id], action)
		case "freeze-address":
		case "unfreeze-address":
			return submitArg(flows[action.id], action)
		case "freeze-shares":
		case "unfreeze-shares":
			return submitArg(flows[action.id], action)
		case "force-transfer":
			return submitArg(flows[action.id], action)
	}
}

const TARGET_ID = "compliance-target"

const ComplianceSection: React.FC<{
	grants: Grant[]
	wallet: string
	addresses: AdminAddresses
	contracts?: React.ReactNode
	active?: boolean
}> = ({ grants, wallet, addresses, contracts, active = true }) => {
	const verifier = addresses.identityVerifier
	const [targetText, setTargetText] = useState("")
	const [inputs, setInputs] = useState<Inputs>({})
	const target = parseAccount(targetText)
	const { target: reads, destination } = useComplianceState({
		verifier,
		target,
		destination: destinationOf(inputs),
		active,
	})
	const flows = useComplianceFlows()

	const modalFlows = COMPLIANCE_ACTION_IDS.map((id) => flow(id, flows[id]))
	const recorded = modalFlows.some(
		(props) => props.status.status === "confirmed",
	)
	useEffect(() => {
		if (recorded) setInputs({})
	}, [recorded])

	const state = {
		verifier,
		target,
		reads,
		vault: vaultContractId,
		destination,
	}
	const actions = toComplianceActions(state, grants, wallet, inputs)

	const onInput = (action: ComplianceAction, value: string, key?: string) => {
		if (key !== undefined)
			setInputs((previous) => ({
				...previous,
				[confirmKey(action.id)]: "",
				[key]: value,
			}))
	}

	const invalid = targetText.trim() !== "" && target === undefined
	const activeModal = modalFlows.find((props) => props.status.status !== "idle")

	return (
		<>
			<SurfaceLayout
				side={
					<CycleActionRail
						scope="compliance"
						actions={actions}
						pending={false}
						unreadable={false}
						onRun={(action) => submit(flows, action)}
						onInput={onInput}
					/>
				}
			>
				<section
					className={layoutStyles.group}
					aria-labelledby="compliance-target-title"
				>
					<h3
						id="compliance-target-title"
						className={`${typeStyles.body} ${layoutStyles.groupTitle}`}
					>
						Target
					</h3>
					<div className={styles.target}>
						<label
							htmlFor={TARGET_ID}
							className={`${typeStyles.footnote} ${styles.label}`}
						>
							Target address
						</label>
						<div className={invalid ? styles.fieldInvalid : styles.field}>
							<input
								id={TARGET_ID}
								className={`${typeStyles.body} ${styles.input}`}
								value={targetText}
								onChange={(event) => setTargetText(event.target.value)}
								placeholder="Address"
								aria-invalid={invalid}
								spellCheck={false}
								autoComplete="off"
							/>
						</div>
					</div>
					<MetricsStrip metrics={toComplianceTiles(reads)} />
				</section>
				{contracts}
			</SurfaceLayout>
			{active && activeModal !== undefined && (
				<TransactionModal {...activeModal} />
			)}
		</>
	)
}

export default ComplianceSection

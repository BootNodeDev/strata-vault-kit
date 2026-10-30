import React, { useEffect, useState } from "react"
import { vaultContractId } from "../../config/contracts"
import { type AdminAddresses, type Grant } from "../../hooks/useAdminAuthority"
import { useComplianceState } from "../../hooks/useComplianceState"
import {
	useAllowAddress,
	useDisallowAddress,
	useFreezeAddress,
	useLegalTransfer,
	useFreezeShares,
	useUnfreezeAddress,
	useUnfreezeShares,
} from "../../hooks/useComplianceTransactions"
import { useLegalTransfers } from "../../hooks/useCycleState"
import {
	prepareFor,
	type Send,
	type Sendable,
	submitTo,
	usePendingTransaction,
	type UsePendingTransaction,
} from "../../hooks/usePendingTransaction"
import { useRailInputs } from "../../hooks/useRailInputs"
import { clearConfirmations, parseAccount } from "../../pages/actions"
import {
	COMPLIANCE_ACTION_IDS,
	type ComplianceAction,
	destinationOf,
	toComplianceActions,
	toComplianceTiles,
} from "../../pages/compliance"
import { toActivityList } from "../../pages/cycle"
import typeStyles from "../../styles/type.module.css"
import MetricsStrip from "../vault/MetricsStrip"
import TransactionModal, {
	type ComplianceModalAction,
	type TransactionModalProps,
} from "../vault/TransactionModal"
import styles from "./ComplianceSection.module.css"
import CycleActionRail from "./CycleActionRail"
import { ActivityTable, Section } from "./CycleSurface"
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
		"legal-transfer": usePendingTransaction(useLegalTransfer()),
	} satisfies Record<ComplianceModalAction, Flow>
}

type Flows = ReturnType<typeof useComplianceFlows>

const sendArg = <Arg,>(
	send: Send,
	flow: Sendable<Arg>,
	{ arg, next, grant }: { arg: Arg | undefined; next: string; grant?: Grant },
) => (arg === undefined ? undefined : send(flow, arg, next, grant))

function dispatch(flows: Flows, action: ComplianceAction, send: Send) {
	switch (action.id) {
		case "allow-address":
		case "disallow-address":
			return sendArg(send, flows[action.id], action)
		case "freeze-address":
		case "unfreeze-address":
			return sendArg(send, flows[action.id], action)
		case "freeze-shares":
		case "unfreeze-shares":
			return sendArg(send, flows[action.id], action)
		case "legal-transfer":
			return sendArg(send, flows[action.id], action)
	}
}

const TARGET_ID = "compliance-target"
const TARGET_ERROR_ID = "compliance-target-error"

const ComplianceSection: React.FC<{
	grants: Grant[]
	wallet: string
	addresses: AdminAddresses
	verifierAdminUnknown?: boolean
	contracts?: React.ReactNode
	active?: boolean
}> = ({
	grants,
	wallet,
	addresses,
	verifierAdminUnknown = false,
	contracts,
	active = true,
}) => {
	const verifier = addresses.identityVerifier
	const [targetText, setTargetText] = useState("")
	const { inputs, setInputs, onInput } = useRailInputs()
	const target = parseAccount(targetText)
	const { target: reads, destination } = useComplianceState({
		verifier,
		target,
		destination: destinationOf(inputs),
	})
	const flows = useComplianceFlows()
	const { legalTransfers } = useLegalTransfers()
	const transfers = toActivityList(legalTransfers)

	const modalFlows = COMPLIANCE_ACTION_IDS.map((id) => flow(id, flows[id]))
	const recorded = modalFlows.some(
		(props) => props.status.status === "confirmed",
	)
	useEffect(() => {
		if (recorded) setInputs({})
	}, [recorded, setInputs])

	const state = {
		verifier,
		target,
		reads,
		vault: vaultContractId,
		destination,
		adminUnknown: verifierAdminUnknown,
	}
	const actions = toComplianceActions(state, grants, wallet, inputs)

	const changeTarget = (text: string) => {
		setTargetText(text)
		setInputs((previous) => clearConfirmations(previous, COMPLIANCE_ACTION_IDS))
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
						onRun={(action) => dispatch(flows, action, submitTo)}
						onReady={
							active
								? (action) => dispatch(flows, action, prepareFor)
								: undefined
						}
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
								onChange={(event) => changeTarget(event.target.value)}
								placeholder="Address"
								aria-invalid={invalid}
								aria-describedby={invalid ? TARGET_ERROR_ID : undefined}
								spellCheck={false}
								autoComplete="off"
							/>
						</div>
						{invalid && (
							<p
								id={TARGET_ERROR_ID}
								className={`${typeStyles.footnote} ${styles.error}`}
							>
								Enter a G… or C… address.
							</p>
						)}
					</div>
					<MetricsStrip metrics={toComplianceTiles(reads)} />
				</section>
				<Section
					title="Legal transfers — last 7 days"
					state={transfers}
					unreadable="Could not read recent legal transfers."
					empty="No legal transfers in the last 7 days."
				>
					{transfers.status === "loaded" && (
						<ActivityTable name="Legal transfers" rows={transfers.rows} />
					)}
				</Section>
				{contracts}
			</SurfaceLayout>
			{active && activeModal !== undefined && (
				<TransactionModal {...activeModal} />
			)}
		</>
	)
}

export default ComplianceSection

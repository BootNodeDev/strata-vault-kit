import React from "react"
import { type Grant } from "../../hooks/useAdminAuthority"
import { useCloseEpoch } from "../../hooks/useCloseEpoch"
import { useCycleEvents, useCycleState } from "../../hooks/useCycleState"
import { useEpochHistory } from "../../hooks/useEpochHistory"
import { useFulfillEpoch } from "../../hooks/useFulfillEpoch"
import { usePendingTransaction } from "../../hooks/usePendingTransaction"
import {
	type CycleAction,
	toActivityList,
	toCycleActions,
	toCycleRows,
	toEpochList,
} from "../../pages/cycle"
import TransactionModal, {
	type TransactionModalProps,
} from "../vault/TransactionModal"
import CycleSurface, { CycleActions, type CycleGroup } from "./CycleSurface"

const EPOCH_GROUP = "Epoch"

const CycleSection: React.FC<{ grants: Grant[] }> = ({ grants }) => {
	const { cycle } = useCycleState()
	const { history } = useEpochHistory()
	const { cycleEvents } = useCycleEvents()
	const closeEpoch = usePendingTransaction(useCloseEpoch())
	const fulfillEpoch = usePendingTransaction(useFulfillEpoch())

	const run = (action: CycleAction) => {
		if (action.epochId === null) return
		const label = String(action.epochId)
		if (action.id === "close-epoch") closeEpoch.submit(undefined, label)
		else fulfillEpoch.submit(action.epochId, label)
	}

	const actions = toCycleActions(cycle, grants)
	const withActions = (group: CycleGroup): CycleGroup =>
		group.title === EPOCH_GROUP && actions.length > 0
			? { ...group, actions: <CycleActions actions={actions} onRun={run} /> }
			: group

	const modalFlows: TransactionModalProps[] = [
		{
			action: "close-epoch",
			status: closeEpoch.status,
			epoch: closeEpoch.amountLabel,
			onClose: closeEpoch.reset,
			onRetry: closeEpoch.retry,
		},
		{
			action: "fulfill-epoch",
			status: fulfillEpoch.status,
			epoch: fulfillEpoch.amountLabel,
			onClose: fulfillEpoch.reset,
			onRetry: fulfillEpoch.retry,
		},
	]
	const activeModal = modalFlows.find((flow) => flow.status.status !== "idle")

	return (
		<>
			<CycleSurface
				groups={toCycleRows(cycle).map(withActions)}
				unreadable={cycle.status === "unreadable"}
				epochs={toEpochList(history)}
				activity={toActivityList(cycleEvents)}
			/>
			{activeModal !== undefined && <TransactionModal {...activeModal} />}
		</>
	)
}

export default CycleSection

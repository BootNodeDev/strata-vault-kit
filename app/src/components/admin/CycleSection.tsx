import React, { useEffect, useState } from "react"
import { type Grant } from "../../hooks/useAdminAuthority"
import { useAttest } from "../../hooks/useAttest"
import { useCloseEpoch } from "../../hooks/useCloseEpoch"
import { useCycleEvents, useCycleState } from "../../hooks/useCycleState"
import { useEpochHistory } from "../../hooks/useEpochHistory"
import { useFulfillEpoch } from "../../hooks/useFulfillEpoch"
import { usePendingTransaction } from "../../hooks/usePendingTransaction"
import {
	type CycleAction,
	formatDuration,
	formatSignedPrice,
	toActivityList,
	toCycleActions,
	toCycleRows,
	toEpochList,
} from "../../pages/cycle"
import TransactionModal, {
	type TransactionModalProps,
} from "../vault/TransactionModal"
import CycleSurface, { CycleActions, type CycleGroup } from "./CycleSurface"

const CycleSection: React.FC<{ grants: Grant[]; wallet: string }> = ({
	grants,
	wallet,
}) => {
	const { cycle } = useCycleState()
	const { history } = useEpochHistory()
	const { cycleEvents } = useCycleEvents()
	const closeEpoch = usePendingTransaction(useCloseEpoch())
	const fulfillEpoch = usePendingTransaction(useFulfillEpoch())
	const attest = usePendingTransaction(useAttest())
	const [priceInput, setPriceInput] = useState("")
	const attested = attest.status.status === "confirmed"

	useEffect(() => {
		if (attested) setPriceInput("")
	}, [attested])

	const run = (action: CycleAction) => {
		switch (action.id) {
			case "close-epoch":
				if (action.epochId !== null)
					closeEpoch.submit(undefined, String(action.epochId))
				return
			case "fulfill-epoch":
				if (action.epochId !== null)
					fulfillEpoch.submit(action.epochId, String(action.epochId))
				return
			case "attest":
				if (action.price !== null && action.freshness !== null)
					attest.submit(
						{ price: action.price, freshness: action.freshness },
						formatSignedPrice(action.price),
					)
		}
	}

	const onInput = (action: CycleAction, value: string) => {
		if (action.id === "attest") setPriceInput(value)
	}

	const actions = toCycleActions(cycle, grants, wallet, priceInput)
	const withActions = (group: CycleGroup): CycleGroup => {
		const own = actions.filter((action) => action.group === group.title)
		return own.length === 0
			? group
			: {
					...group,
					actions: <CycleActions actions={own} onRun={run} onInput={onInput} />,
				}
	}

	const freshness =
		cycle.status === "ready" ? cycle.oracle.limits?.freshness : undefined

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
		{
			action: "attest",
			status: attest.status,
			price: attest.amountLabel,
			validFor: freshness === undefined ? null : formatDuration(freshness),
			onClose: attest.reset,
			onRetry: attest.retry,
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

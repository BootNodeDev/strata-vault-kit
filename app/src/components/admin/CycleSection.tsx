import React, { useEffect, useState } from "react"
import { useActivateWindDown } from "../../hooks/useActivateWindDown"
import { type Grant } from "../../hooks/useAdminAuthority"
import { useAttest } from "../../hooks/useAttest"
import { useCloseEpoch } from "../../hooks/useCloseEpoch"
import { useCycleEvents, useCycleState } from "../../hooks/useCycleState"
import { useDeployToCustodian } from "../../hooks/useDeployToCustodian"
import { useDepositBalance } from "../../hooks/useDepositBalance"
import { useEpochHistory } from "../../hooks/useEpochHistory"
import { useFinalizeWindDownRound } from "../../hooks/useFinalizeWindDownRound"
import { useFulfillEpoch } from "../../hooks/useFulfillEpoch"
import { useFund } from "../../hooks/useFund"
import { usePendingTransaction } from "../../hooks/usePendingTransaction"
import {
	type CycleAction,
	exactAmount,
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

const useAmountInput = (confirmed: boolean) => {
	const [input, setInput] = useState("")
	useEffect(() => {
		if (confirmed) setInput("")
	}, [confirmed])
	return [input, setInput] as const
}

const CycleSection: React.FC<{ grants: Grant[]; wallet: string }> = ({
	grants,
	wallet,
}) => {
	const { cycle } = useCycleState()
	const { history } = useEpochHistory()
	const { cycleEvents } = useCycleEvents()
	const { balance } = useDepositBalance()
	const closeEpoch = usePendingTransaction(useCloseEpoch())
	const fulfillEpoch = usePendingTransaction(useFulfillEpoch())
	const attest = usePendingTransaction(useAttest())
	const deploy = usePendingTransaction(useDeployToCustodian())
	const fund = usePendingTransaction(useFund())
	const activateWindDown = usePendingTransaction(useActivateWindDown())
	const finalizeRound = usePendingTransaction(useFinalizeWindDownRound())
	const [priceInput, setPriceInput] = useAmountInput(
		attest.status.status === "confirmed",
	)
	const [deployInput, setDeployInput] = useAmountInput(
		deploy.status.status === "confirmed",
	)
	const [fundInput, setFundInput] = useAmountInput(
		fund.status.status === "confirmed",
	)

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
				return
			case "deploy":
				if (action.amount !== null)
					deploy.submit(action.amount, exactAmount(action.amount))
				return
			case "fund":
				if (action.amount !== null)
					fund.submit(action.amount, exactAmount(action.amount))
				return
			case "activate-wind-down":
				activateWindDown.submit(undefined, "")
				return
			case "finalize-round":
				if (action.round !== null)
					finalizeRound.submit(undefined, String(action.round))
		}
	}

	const onInput = (action: CycleAction, value: string) => {
		switch (action.id) {
			case "attest":
				setPriceInput(value)
				return
			case "deploy":
				setDeployInput(value)
				return
			case "fund":
				setFundInput(value)
				return
			case "close-epoch":
			case "fulfill-epoch":
			case "activate-wind-down":
			case "finalize-round":
				return
		}
	}

	const actions = toCycleActions(cycle, grants, wallet, {
		price: priceInput,
		deploy: deployInput,
		fund: fundInput,
		walletBalance: balance.status === "held" ? balance.amount : null,
	})
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
		{
			action: "deploy",
			status: deploy.status,
			amount: deploy.amountLabel,
			onClose: deploy.reset,
			onRetry: deploy.retry,
		},
		{
			action: "fund",
			status: fund.status,
			amount: fund.amountLabel,
			onClose: fund.reset,
			onRetry: fund.retry,
		},
		{
			action: "activate-wind-down",
			status: activateWindDown.status,
			onClose: activateWindDown.reset,
			onRetry: activateWindDown.retry,
		},
		{
			action: "finalize-round",
			status: finalizeRound.status,
			round: finalizeRound.amountLabel,
			onClose: finalizeRound.reset,
			onRetry: finalizeRound.retry,
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

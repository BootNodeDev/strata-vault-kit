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
import {
	prepareFor,
	type Send,
	submitTo,
	usePendingTransaction,
} from "../../hooks/usePendingTransaction"
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
import CycleActionRail from "./CycleActionRail"
import CycleSurface from "./CycleSurface"

const useClearedInput = (confirmed: boolean) => {
	const [input, setInput] = useState("")
	useEffect(() => {
		if (confirmed) setInput("")
	}, [confirmed])
	return [input, setInput] as const
}

const CycleSection: React.FC<{
	grants: Grant[]
	wallet: string
	contracts?: React.ReactNode
	active?: boolean
}> = ({ grants, wallet, contracts, active = true }) => {
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
	const attested = attest.status.status === "confirmed"
	const [priceInput, setPriceInput] = useClearedInput(attested)
	const [proofHashInput, setProofHashInput] = useClearedInput(attested)
	const [proofUriInput, setProofUriInput] = useClearedInput(attested)
	const [deployInput, setDeployInput] = useClearedInput(
		deploy.status.status === "confirmed",
	)
	const [fundInput, setFundInput] = useClearedInput(
		fund.status.status === "confirmed",
	)

	const dispatch = (action: CycleAction, send: Send) => {
		switch (action.id) {
			case "close-epoch":
				if (action.epochId !== null)
					return send(
						closeEpoch,
						undefined,
						String(action.epochId),
						action.grant,
					)
				return undefined
			case "fulfill-epoch":
				if (action.epochId !== null)
					return send(fulfillEpoch, action.epochId, String(action.epochId))
				return undefined
			case "attest":
				if (
					action.price !== null &&
					action.freshness !== null &&
					action.proofHash !== null
				)
					return send(
						attest,
						{
							price: action.price,
							freshness: action.freshness,
							proofHash: action.proofHash,
							proofUri: action.proofUri,
						},
						formatSignedPrice(action.price),
						action.grant,
					)
				return undefined
			case "deploy":
				if (action.amount !== null)
					return send(
						deploy,
						action.amount,
						exactAmount(action.amount),
						action.grant,
					)
				return undefined
			case "fund":
				if (action.amount !== null)
					return send(fund, action.amount, exactAmount(action.amount))
				return undefined
			case "activate-wind-down":
				return send(activateWindDown, undefined, "")
			case "finalize-round":
				if (action.round !== null)
					return send(finalizeRound, undefined, String(action.round))
				return undefined
		}
	}

	const onInput = (action: CycleAction, value: string, key?: string) => {
		switch (action.id) {
			case "attest":
				if (key === "proof-hash") setProofHashInput(value)
				else if (key === "proof-uri") setProofUriInput(value)
				else setPriceInput(value)
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
		proofHash: proofHashInput,
		proofUri: proofUriInput,
		deploy: deployInput,
		fund: fundInput,
		walletBalance: balance.status === "held" ? balance.amount : null,
	})

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
				groups={toCycleRows(cycle)}
				unreadable={cycle.status === "unreadable"}
				epochs={toEpochList(history)}
				activity={toActivityList(cycleEvents)}
				rail={
					<CycleActionRail
						scope="cycle"
						actions={actions}
						pending={cycle.status === "checking"}
						unreadable={cycle.status === "unreadable"}
						onRun={(action) => dispatch(action, submitTo)}
						onReady={
							active ? (action) => dispatch(action, prepareFor) : undefined
						}
						onInput={onInput}
					/>
				}
				contracts={contracts}
			/>
			{active && activeModal !== undefined && (
				<TransactionModal {...activeModal} />
			)}
		</>
	)
}

export default CycleSection

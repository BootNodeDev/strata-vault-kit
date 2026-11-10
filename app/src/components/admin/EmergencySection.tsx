import React from "react"
import { type Grant } from "../../hooks/useAdminAuthority"
import { type TransactionStatus } from "../../hooks/useContractTransaction"
import {
	useClearLatest,
	usePauseToken,
	usePauseVault,
	usePauseNav,
	useSetNavPaused,
	useUnpauseToken,
	useUnpauseVault,
} from "../../hooks/useEmergencyTransactions"
import { useOracleState } from "../../hooks/useOracleState"
import {
	prepareFor,
	type Send,
	submitTo,
	usePendingTransaction,
} from "../../hooks/usePendingTransaction"
import { useSetupOpen } from "../../hooks/useSetupOpen"
import { useTokenPaused } from "../../hooks/useTokenPaused"
import { useVaultPaused } from "../../hooks/useVaultPaused"
import {
	type EmergencyAction,
	type EmergencyState,
	toEmergencyActions,
	toEmergencyTiles,
} from "../../pages/emergency"
import typeStyles from "../../styles/type.module.css"
import MetricsStrip from "../vault/MetricsStrip"
import TransactionModal, {
	type TransactionModalProps,
} from "../vault/TransactionModal"
import CycleActionRail from "./CycleActionRail"
import SurfaceLayout from "./SurfaceLayout"
import layoutStyles from "./SurfaceLayout.module.css"

const PAUSE = "pause"
const UNPAUSE = "unpause"

const EmergencySection: React.FC<{
	grants: Grant[]
	wallet: string
	contracts?: React.ReactNode
	active?: boolean
}> = ({ grants, wallet, contracts, active = true }) => {
	const { pause: vault } = useVaultPaused({ poll: true })
	const { setup } = useSetupOpen("vault")
	const { pause: token } = useTokenPaused()
	const { oracle } = useOracleState()
	const pauseVault = usePendingTransaction(usePauseVault())
	const unpauseVault = usePendingTransaction(useUnpauseVault())
	const pauseNav = usePendingTransaction(usePauseNav())
	const setNavPaused = usePendingTransaction(useSetNavPaused())
	const clearLatest = usePendingTransaction(useClearLatest())
	const pauseToken = usePendingTransaction(usePauseToken())
	const unpauseToken = usePendingTransaction(useUnpauseToken())

	const state: EmergencyState = { vault, setup, token, oracle }
	const actions = toEmergencyActions(state, grants, wallet)

	const dispatch = (action: EmergencyAction, send: Send) => {
		switch (action.id) {
			case "pause-vault":
				return send(pauseVault, undefined, "", action.grant)
			case "unpause-vault":
				return send(unpauseVault, undefined, "", action.grant)
			case "pause-nav":
				return action.viaAdmin
					? send(setNavPaused, true, PAUSE, action.grant)
					: send(pauseNav, undefined, "", action.grant)
			case "unpause-nav":
				return send(setNavPaused, false, UNPAUSE, action.grant)
			case "clear-latest":
				return send(clearLatest, undefined, "", action.grant)
			case "pause-token":
				return send(pauseToken, undefined, "", action.grant)
			case "unpause-token":
				return send(unpauseToken, undefined, "", action.grant)
		}
	}

	const flow = (
		action: TransactionModalProps["action"] & EmergencyAction["id"],
		transaction: {
			status: TransactionStatus
			reset: () => void
			retry: () => void
		},
	): TransactionModalProps => ({
		action,
		status: transaction.status,
		onClose: transaction.reset,
		onRetry: transaction.retry,
	})

	const modalFlows: TransactionModalProps[] = [
		flow("pause-vault", pauseVault),
		flow("unpause-vault", unpauseVault),
		flow("pause-nav", pauseNav),
		flow(
			setNavPaused.amountLabel === PAUSE ? "pause-nav" : "unpause-nav",
			setNavPaused,
		),
		flow("clear-latest", clearLatest),
		flow("pause-token", pauseToken),
		flow("unpause-token", unpauseToken),
	]
	const activeModal = modalFlows.find((props) => props.status.status !== "idle")

	return (
		<>
			<SurfaceLayout
				side={
					<CycleActionRail
						scope="emergency"
						actions={actions}
						pending={false}
						unreadable={false}
						onRun={(action) => dispatch(action, submitTo)}
						onReady={
							active ? (action) => dispatch(action, prepareFor) : undefined
						}
					/>
				}
			>
				<section
					className={layoutStyles.group}
					aria-labelledby="emergency-status"
				>
					<h3
						id="emergency-status"
						className={`${typeStyles.body} ${layoutStyles.groupTitle}`}
					>
						Status
					</h3>
					<MetricsStrip metrics={toEmergencyTiles(state)} />
				</section>
				{contracts}
			</SurfaceLayout>
			{active && activeModal !== undefined && (
				<TransactionModal {...activeModal} />
			)}
		</>
	)
}

export default EmergencySection

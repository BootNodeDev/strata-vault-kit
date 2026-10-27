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
import { usePendingTransaction } from "../../hooks/usePendingTransaction"
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

	const run = (action: EmergencyAction) => {
		switch (action.id) {
			case "pause-vault":
				pauseVault.submit(undefined, "", action.grant)
				return
			case "unpause-vault":
				unpauseVault.submit(undefined, "", action.grant)
				return
			case "pause-nav":
				if (action.viaAdmin) setNavPaused.submit(true, PAUSE, action.grant)
				else pauseNav.submit(undefined, "", action.grant)
				return
			case "unpause-nav":
				setNavPaused.submit(false, UNPAUSE, action.grant)
				return
			case "clear-latest":
				clearLatest.submit(undefined, "", action.grant)
				return
			case "pause-token":
				pauseToken.submit(undefined, "", action.grant)
				return
			case "unpause-token":
				unpauseToken.submit(undefined, "", action.grant)
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
						onRun={run}
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

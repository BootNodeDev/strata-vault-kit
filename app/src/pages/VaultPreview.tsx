import {
	AMOUNT_DECIMALS,
	type Amount,
	connectWallet,
	formatAmount,
	formatScaled,
	networkStatus,
	parseAmount,
	parseUnits,
	profileModal,
	shortAddress,
} from "@stellar-scaffold/app-lib"
import React from "react"
import Copy from "../components/icons/Copy"
import AboutVault, { type FigureGroup } from "../components/vault/AboutVault"
import ActionPanel, {
	type ActionPanelSide,
} from "../components/vault/ActionPanel"
import MetricsStrip, { type Metric } from "../components/vault/MetricsStrip"
import PositionCard from "../components/vault/PositionCard"
import { type RequestStage } from "../components/vault/RequestCard"
import RequestList, { type RequestGroup } from "../components/vault/RequestList"
import TransactionModal from "../components/vault/TransactionModal"
import { contractRows, vaultContractId } from "../config/contracts"
import { useCancelDeposit } from "../hooks/useCancelDeposit"
import { useCancelRedeem } from "../hooks/useCancelRedeem"
import { useClaimDeposit } from "../hooks/useClaimDeposit"
import { useDepositBalance } from "../hooks/useDepositBalance"
import {
	type InvestorRequest,
	useInvestorRequests,
} from "../hooks/useInvestorRequests"
import { useIsAllowed } from "../hooks/useIsAllowed"
import { useNavPrice } from "../hooks/useNavPrice"
import { useRequestDeposit } from "../hooks/useRequestDeposit"
import { useRequestRedeem } from "../hooks/useRequestRedeem"
import { useSharePosition } from "../hooks/useSharePosition"
import { useTokenSymbols } from "../hooks/useTokenSymbols"
import { useVaultAuthorities } from "../hooks/useVaultAuthorities"
import { useVaultFigures } from "../hooks/useVaultFigures"
import { useVaultPaused } from "../hooks/useVaultPaused"
import { useWallet } from "../hooks/useWallet"
import typeStyles from "../styles/type.module.css"
import {
	deriveAccess,
	emptyMessages,
	isSubscriptionOpen,
	toActionBalance,
	toPanelBlock,
	toPosition,
	toPriceBlock,
} from "./vaultAccess"
import {
	toAuthorityRows,
	toEstimate,
	toMetrics,
	toPriceMetric,
	toSizeFigures,
} from "./vaultMetrics"
import styles from "./VaultPreview.module.css"
import { allowlistRefusalFor, toRequestEntriesByStage } from "./vaultRequests"

const sections: { id: string; label: string }[] = [
	{ id: "requests", label: "Requests" },
	{ id: "position", label: "Position" },
	{ id: "about", label: "About" },
]

const vaultSummary = [
	"Shares in this vault are a claim on an off-chain asset priced by an oracle. Subscribing or redeeming opens a request that becomes claimable once the oracle prices it.",
	"A share claim is ready the moment it prices. A cash claim waits until the vault's reserve can cover it in full. You may hold one open request per side, and only share claims need an allowlisted address.",
]

const VaultPreview: React.FC = () => {
	const [openTooltipId, setOpenTooltipId] = React.useState<
		string | number | null
	>(null)
	const [activeStage, setActiveStage] = React.useState<RequestStage>("ready")
	const [copied, setCopied] = React.useState(false)
	const [actionSide, setActionSide] =
		React.useState<ActionPanelSide>("subscribe")
	const [actionAmount, setActionAmount] = React.useState("")

	const { figures, isPending: isPendingFigures } = useVaultFigures()
	const { authorities, isPending: isPendingAuthorities } = useVaultAuthorities()
	const { nav, isPending: isPendingNav } = useNavPrice()
	const { address, networkPassphrase } = useWallet()
	const { allowance } = useIsAllowed()
	const { position } = useSharePosition()
	const { balance: deposit } = useDepositBalance()
	const { symbols } = useTokenSymbols()
	const { requests } = useInvestorRequests()
	const { pause } = useVaultPaused()
	const {
		status: requestDepositStatus,
		submit: submitRequestDeposit,
		reset: resetRequestDeposit,
	} = useRequestDeposit()
	const [pendingAmountLabel, setPendingAmountLabel] = React.useState("")
	const [pendingAmount, setPendingAmount] = React.useState<Amount | null>(null)
	const {
		status: cancelDepositStatus,
		submit: submitCancelDeposit,
		reset: resetCancelDeposit,
	} = useCancelDeposit()
	const [pendingCancelAmountLabel, setPendingCancelAmountLabel] =
		React.useState("")
	const [pendingCancelEpochId, setPendingCancelEpochId] = React.useState<
		bigint | null
	>(null)
	const {
		status: claimDepositStatus,
		submit: submitClaimDeposit,
		reset: resetClaimDeposit,
	} = useClaimDeposit()
	const [pendingClaimAmountLabel, setPendingClaimAmountLabel] =
		React.useState("")
	const [pendingClaimEpochId, setPendingClaimEpochId] = React.useState<
		bigint | null
	>(null)
	const {
		status: requestRedeemStatus,
		submit: submitRequestRedeem,
		reset: resetRequestRedeem,
	} = useRequestRedeem()
	const [pendingRedeemAmountLabel, setPendingRedeemAmountLabel] =
		React.useState("")
	const [pendingRedeemAmount, setPendingRedeemAmount] =
		React.useState<Amount | null>(null)
	const {
		status: cancelRedeemStatus,
		submit: submitCancelRedeem,
		reset: resetCancelRedeem,
	} = useCancelRedeem()
	const [pendingCancelRedeemAmountLabel, setPendingCancelRedeemAmountLabel] =
		React.useState("")
	const [pendingCancelRedeemEpochId, setPendingCancelRedeemEpochId] =
		React.useState<bigint | null>(null)
	const { state, appNetwork, walletNetwork } = networkStatus(
		address,
		networkPassphrase,
	)
	const access = deriveAccess({
		address,
		network: { state, appNetwork, walletNetwork },
		allowance,
	})
	const isSubscribe = actionSide === "subscribe"
	const block =
		toPanelBlock(access, connectWallet, profileModal, {
			isSubscribe,
			pause,
			hasOpenSubscription: isSubscriptionOpen(requests),
		}) ?? toPriceBlock(nav, isPendingNav)
	const cancelDeposit = (request: InvestorRequest) => {
		if (!submitCancelDeposit(request.epochId)) return
		setPendingCancelEpochId(request.epochId)
		setPendingCancelAmountLabel(formatScaled(request.amount, AMOUNT_DECIMALS))
	}
	const retryCancelDeposit = () => {
		if (pendingCancelEpochId === null) return
		submitCancelDeposit(pendingCancelEpochId)
	}
	const cancelRedeem = (request: InvestorRequest) => {
		if (!submitCancelRedeem(request.epochId)) return
		setPendingCancelRedeemEpochId(request.epochId)
		setPendingCancelRedeemAmountLabel(
			formatScaled(request.amount, AMOUNT_DECIMALS),
		)
	}
	const retryCancelRedeem = () => {
		if (pendingCancelRedeemEpochId === null) return
		submitCancelRedeem(pendingCancelRedeemEpochId)
	}
	const cancelRequest = (request: InvestorRequest) => {
		if (request.side === "deposit") {
			cancelDeposit(request)
			return
		}
		cancelRedeem(request)
	}
	const claimDeposit = (request: InvestorRequest) => {
		if (!submitClaimDeposit(request.epochId)) return
		setPendingClaimEpochId(request.epochId)
		setPendingClaimAmountLabel(formatScaled(request.amount, AMOUNT_DECIMALS))
	}
	const retryClaimDeposit = () => {
		if (pendingClaimEpochId === null) return
		submitClaimDeposit(pendingClaimEpochId)
	}

	const messages = emptyMessages(requests.status)
	const entriesByStage =
		requests.status === "loaded"
			? toRequestEntriesByStage(
					requests,
					symbols,
					allowlistRefusalFor(allowance),
					cancelRequest,
					claimDeposit,
				)
			: undefined
	const requestGroups: [RequestGroup, ...RequestGroup[]] = [
		{
			id: "ready",
			label: "Ready to claim",
			entries: entriesByStage?.ready ?? [],
			emptyMessage: messages.ready,
		},
		{
			id: "waiting",
			label: "Waiting",
			entries: entriesByStage?.waiting ?? [],
			emptyMessage: messages.waiting,
		},
		{
			id: "blocked",
			label: "Blocked",
			entries: entriesByStage?.blocked ?? [],
			emptyMessage: messages.blocked,
		},
	]

	const metrics: [Metric, Metric, Metric, Metric] = [
		toPriceMetric(nav, isPendingNav),
		...toMetrics(figures, isPendingFigures, symbols.token),
	]
	const authorityRows = toAuthorityRows(authorities, isPendingAuthorities)
	const sizeFigures: FigureGroup = {
		title: "Vault size",
		rows: toSizeFigures(figures, isPendingFigures),
	}

	const toggleTooltip = (id: string | number) => {
		setOpenTooltipId((current) => (current === id ? null : id))
	}

	const changeActionSide = (side: ActionPanelSide) => {
		setActionSide(side)
		setActionAmount("")
	}

	const changeStage = (stage: RequestStage) => {
		setActiveStage(stage)
		setOpenTooltipId(null)
	}

	const inTicker = isSubscribe ? symbols.token : symbols.shareToken
	const outTicker = isSubscribe ? symbols.shareToken : symbols.token
	const balance = toActionBalance(
		isSubscribe,
		block !== undefined,
		deposit,
		position,
	)
	const balanceLabel =
		balance === null
			? "Balance unavailable"
			: `Balance ${formatAmount(balance)}`
	const parsedAmount = parseAmount(actionAmount)
	const estimate = toEstimate(nav, parsedAmount, isSubscribe, outTicker)

	const submitAction = () => {
		if (parsedAmount === null) return
		const amount = parseUnits(actionAmount, AMOUNT_DECIMALS)
		if (amount === null) return
		if (isSubscribe) {
			if (!submitRequestDeposit(amount)) return
			setPendingAmountLabel(formatAmount(parsedAmount))
			setPendingAmount(amount)
			return
		}
		if (!submitRequestRedeem(amount)) return
		setPendingRedeemAmountLabel(formatAmount(parsedAmount))
		setPendingRedeemAmount(amount)
	}

	const retryRequestDeposit = () => {
		if (pendingAmount === null) return
		submitRequestDeposit(pendingAmount)
	}

	const retryRequestRedeem = () => {
		if (pendingRedeemAmount === null) return
		submitRequestRedeem(pendingRedeemAmount)
	}

	React.useEffect(() => {
		if (requestDepositStatus.status === "confirmed") setActionAmount("")
	}, [requestDepositStatus])

	React.useEffect(() => {
		if (requestRedeemStatus.status === "confirmed") setActionAmount("")
	}, [requestRedeemStatus])

	const copyAddress = async () => {
		try {
			await navigator.clipboard.writeText(vaultContractId)
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch {
			// Clipboard access can be denied by the browser; the address is still visible.
		}
	}

	return (
		<div className={styles.page}>
			<div className={styles.identity}>
				<h1 className={typeStyles.vaultName}>{symbols.vaultName}</h1>
				<div className={styles.address}>
					<span className={`${typeStyles.railValue} ${styles.addressValue}`}>
						{shortAddress(vaultContractId)}
					</span>
					<button
						type="button"
						className={`${typeStyles.label} ${styles.copyButton}`}
						onClick={copyAddress}
					>
						<Copy className={styles.copyIcon} />
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
			</div>

			<MetricsStrip metrics={metrics} />

			<div className={styles.body}>
				<nav aria-label="Sections" className={styles.nav}>
					{sections.map((section) => (
						<a
							key={section.id}
							href={`#${section.id}`}
							className={`${typeStyles.body} ${styles.navLink}`}
						>
							{section.label}
						</a>
					))}
				</nav>

				<div className={styles.main}>
					<div id="requests" className={styles.anchor}>
						<RequestList
							heading="Your requests"
							groups={requestGroups}
							activeStage={activeStage}
							onStageChange={changeStage}
							openTooltipId={openTooltipId}
							onToggleTooltip={toggleTooltip}
						/>
					</div>

					<section id="position" className={styles.anchor}>
						<PositionCard
							heading="Your position"
							label="Your shares"
							sub="In your wallet"
							{...toPosition(position, symbols.shareToken)}
						/>
					</section>

					<div id="about" className={styles.anchor}>
						<AboutVault
							summary={vaultSummary}
							figures={sizeFigures}
							groups={[
								{ title: "Contracts", rows: contractRows },
								{ title: "Authorities", rows: authorityRows },
							]}
						/>
					</div>
				</div>

				<aside className={styles.side} aria-label="Actions">
					<ActionPanel
						side={actionSide}
						onSideChange={changeActionSide}
						heading={
							isSubscribe ? "Request a subscription" : "Request a redemption"
						}
						note="Your request prices at the vault's next update."
						amount={actionAmount}
						onAmountChange={setActionAmount}
						amountLabel={
							isSubscribe ? "Amount to subscribe" : "Amount to redeem"
						}
						ticker={inTicker}
						balance={balance}
						balanceLabel={balanceLabel}
						estimate={estimate}
						submitLabel={isSubscribe ? "Subscribe" : "Redeem"}
						onSubmit={submitAction}
						block={block}
					/>
				</aside>
			</div>

			{requestDepositStatus.status !== "idle" ? (
				<TransactionModal
					action="subscribe"
					status={requestDepositStatus}
					amount={pendingAmountLabel}
					ticker={inTicker}
					onClose={resetRequestDeposit}
					onRetry={retryRequestDeposit}
				/>
			) : requestRedeemStatus.status !== "idle" ? (
				<TransactionModal
					action="redeem"
					status={requestRedeemStatus}
					amount={pendingRedeemAmountLabel}
					ticker={symbols.shareToken}
					onClose={resetRequestRedeem}
					onRetry={retryRequestRedeem}
				/>
			) : cancelDepositStatus.status !== "idle" ? (
				<TransactionModal
					action="cancel"
					status={cancelDepositStatus}
					amount={pendingCancelAmountLabel}
					ticker={symbols.token}
					onClose={resetCancelDeposit}
					onRetry={retryCancelDeposit}
				/>
			) : cancelRedeemStatus.status !== "idle" ? (
				<TransactionModal
					action="cancel-redeem"
					status={cancelRedeemStatus}
					amount={pendingCancelRedeemAmountLabel}
					ticker={symbols.shareToken}
					onClose={resetCancelRedeem}
					onRetry={retryCancelRedeem}
				/>
			) : (
				claimDepositStatus.status !== "idle" && (
					<TransactionModal
						action="claim"
						status={claimDepositStatus}
						amount={pendingClaimAmountLabel}
						ticker={symbols.token}
						shareTicker={symbols.shareToken}
						onClose={resetClaimDeposit}
						onRetry={retryClaimDeposit}
					/>
				)
			)}
		</div>
	)
}

export default VaultPreview

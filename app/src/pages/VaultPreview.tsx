import {
	AMOUNT_DECIMALS,
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
import TransactionModal, {
	type TransactionModalProps,
} from "../components/vault/TransactionModal"
import { contractRows, vaultContractId } from "../config/contracts"
import { useCancelDeposit } from "../hooks/useCancelDeposit"
import { useCancelRedeem } from "../hooks/useCancelRedeem"
import { useClaimDeposit } from "../hooks/useClaimDeposit"
import { useClaimRedeem } from "../hooks/useClaimRedeem"
import { useDepositBalance } from "../hooks/useDepositBalance"
import {
	type InvestorRequest,
	useInvestorRequests,
} from "../hooks/useInvestorRequests"
import { useIsAllowed } from "../hooks/useIsAllowed"
import { useNavPrice } from "../hooks/useNavPrice"
import { usePendingTransaction } from "../hooks/usePendingTransaction"
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
import {
	allowlistRefusalFor,
	owedAmount,
	toRequestEntriesByStage,
} from "./vaultRequests"

const sections: { id: string; label: string }[] = [
	{ id: "requests", label: "Requests" },
	{ id: "position", label: "Position" },
	{ id: "about", label: "About" },
]

function vaultSummary(token: string | undefined): string[] {
	const claimWord = token ?? "redemption"
	return [
		"Shares in this vault are a claim on an off-chain asset priced by an oracle. Subscribing or redeeming opens a request that becomes claimable once the oracle prices it.",
		`A share claim is ready the moment it prices. A ${claimWord} claim waits until the vault's reserve can cover it in full. You may hold one open request per side, and only share claims need an allowlisted address.`,
	]
}

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
	const tokenSymbol = symbols?.token ?? ""
	const shareTokenSymbol = symbols?.shareToken ?? ""
	const { requests } = useInvestorRequests()
	const { pause } = useVaultPaused()
	const requestDeposit = usePendingTransaction(useRequestDeposit())
	const cancelDepositTx = usePendingTransaction(useCancelDeposit())
	const claimDepositTx = usePendingTransaction(useClaimDeposit())
	const requestRedeem = usePendingTransaction(useRequestRedeem())
	const cancelRedeemTx = usePendingTransaction(useCancelRedeem())
	const claimRedeemTx = usePendingTransaction(useClaimRedeem())
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
		cancelDepositTx.submit(
			request.epochId,
			formatScaled(request.amount, AMOUNT_DECIMALS),
		)
	}
	const cancelRedeem = (request: InvestorRequest) => {
		cancelRedeemTx.submit(
			request.epochId,
			formatScaled(request.amount, AMOUNT_DECIMALS),
		)
	}
	const cancelRequest = (request: InvestorRequest) => {
		if (request.side === "deposit") {
			cancelDeposit(request)
			return
		}
		cancelRedeem(request)
	}
	const claimRequest = (request: InvestorRequest) => {
		if (request.side === "deposit") {
			claimDepositTx.submit(
				request.epochId,
				formatScaled(request.amount, AMOUNT_DECIMALS),
			)
			return
		}
		claimRedeemTx.submit(
			request.epochId,
			formatScaled(
				owedAmount(request.side, request.amount, request.sharePrice),
				AMOUNT_DECIMALS,
			),
		)
	}

	const messages = emptyMessages(requests.status, symbols?.token)
	const entriesByStage =
		requests.status === "loaded"
			? toRequestEntriesByStage(
					requests,
					{ token: tokenSymbol, shareToken: shareTokenSymbol },
					allowlistRefusalFor(allowance),
					cancelRequest,
					claimRequest,
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
		...toMetrics(figures, isPendingFigures, tokenSymbol),
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

	const inTicker = isSubscribe ? tokenSymbol : shareTokenSymbol
	const outTicker = isSubscribe ? shareTokenSymbol : tokenSymbol
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
		const amountLabel = formatAmount(parsedAmount)
		if (isSubscribe) {
			requestDeposit.submit(amount, amountLabel)
			return
		}
		requestRedeem.submit(amount, amountLabel)
	}

	React.useEffect(() => {
		if (requestDeposit.status.status === "confirmed") setActionAmount("")
	}, [requestDeposit.status])

	React.useEffect(() => {
		if (requestRedeem.status.status === "confirmed") setActionAmount("")
	}, [requestRedeem.status])

	const uncovered =
		!isPendingFigures && figures !== undefined && figures.uncovered !== null
			? `${formatScaled(figures.uncovered, AMOUNT_DECIMALS)} ${tokenSymbol}`
			: undefined

	const modalFlows: TransactionModalProps[] = [
		{
			action: "subscribe",
			status: requestDeposit.status,
			amount: requestDeposit.amountLabel,
			ticker: inTicker,
			onClose: requestDeposit.reset,
			onRetry: requestDeposit.retry,
		},
		{
			action: "redeem",
			status: requestRedeem.status,
			amount: requestRedeem.amountLabel,
			ticker: shareTokenSymbol,
			onClose: requestRedeem.reset,
			onRetry: requestRedeem.retry,
		},
		{
			action: "cancel",
			status: cancelDepositTx.status,
			amount: cancelDepositTx.amountLabel,
			ticker: tokenSymbol,
			onClose: cancelDepositTx.reset,
			onRetry: cancelDepositTx.retry,
		},
		{
			action: "cancel-redeem",
			status: cancelRedeemTx.status,
			amount: cancelRedeemTx.amountLabel,
			ticker: shareTokenSymbol,
			assetTicker: tokenSymbol,
			onClose: cancelRedeemTx.reset,
			onRetry: cancelRedeemTx.retry,
		},
		{
			action: "claim",
			status: claimDepositTx.status,
			amount: claimDepositTx.amountLabel,
			ticker: tokenSymbol,
			shareTicker: shareTokenSymbol,
			onClose: claimDepositTx.reset,
			onRetry: claimDepositTx.retry,
		},
		{
			action: "claim-redeem",
			status: claimRedeemTx.status,
			amount: claimRedeemTx.amountLabel,
			ticker: tokenSymbol,
			uncovered,
			onClose: claimRedeemTx.reset,
			onRetry: claimRedeemTx.retry,
		},
	]
	const activeModal = modalFlows.find((flow) => flow.status.status !== "idle")

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
				<h1 className={typeStyles.vaultName}>
					{symbols?.vaultName ?? "Vault"}
				</h1>
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
							{...toPosition(position, shareTokenSymbol)}
						/>
					</section>

					<div id="about" className={styles.anchor}>
						<AboutVault
							summary={vaultSummary(symbols?.token)}
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

			{activeModal !== undefined && <TransactionModal {...activeModal} />}
		</div>
	)
}

export default VaultPreview

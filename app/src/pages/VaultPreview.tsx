import {
	connectWallet,
	formatAmount,
	networkStatus,
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
import { contractRows, vaultContractId } from "../config/contracts"
import { useDepositBalance } from "../hooks/useDepositBalance"
import { useIsAllowed } from "../hooks/useIsAllowed"
import { useNavPrice } from "../hooks/useNavPrice"
import { useSharePosition } from "../hooks/useSharePosition"
import { useTokenSymbols } from "../hooks/useTokenSymbols"
import { useVaultAuthorities } from "../hooks/useVaultAuthorities"
import { useVaultFigures } from "../hooks/useVaultFigures"
import { useWallet } from "../hooks/useWallet"
import typeStyles from "../styles/type.module.css"
import {
	deriveAccess,
	emptyMessages,
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

const sections: { id: string; label: string }[] = [
	{ id: "requests", label: "Requests" },
	{ id: "position", label: "Position" },
	{ id: "about", label: "About" },
]

const vaultSummary = [
	"Shares in this vault are a claim on an off-chain asset whose NAV is published on chain by an oracle. No price exists at the moment you act, so entry and exit are requests: what you put in is locked, and its batch is priced once the oracle can price it. Pricing does not wait for cash. The debt is recorded at the attested price, and each claim becomes claimable once the reserve covers it in full, in any order rather than by queue position.",
	"You may hold one request per side per batch, and one price applies to everyone in it. A share claim is claimable at once; a cash claim waits for the reserve to cover it in full. Shares need an allowlisted address to claim, cash does not.",
]

const parseAmount = (raw: string): number | null => {
	const value = Number(raw.replace(/,/g, ""))
	return Number.isFinite(value) && value > 0 ? value : null
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
	const { state, appNetwork, walletNetwork } = networkStatus(
		address,
		networkPassphrase,
	)
	const access = deriveAccess({
		address,
		network: { state, appNetwork, walletNetwork },
		allowance,
	})
	const block =
		toPanelBlock(access, connectWallet, profileModal) ??
		toPriceBlock(nav, isPendingNav)
	const connected = address !== undefined
	const messages = emptyMessages(connected)
	const requestGroups: [RequestGroup, RequestGroup] = [
		{
			id: "ready",
			label: "Ready to claim",
			entries: [],
			emptyMessage: messages.ready,
		},
		{
			id: "waiting",
			label: "Waiting",
			entries: [],
			emptyMessage: messages.waiting,
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

	const isSubscribe = actionSide === "subscribe"
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
	const estimateValue = toEstimate(nav, parsedAmount, isSubscribe, outTicker)
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
						note="Your request joins the batch that is currently open."
						amount={actionAmount}
						onAmountChange={setActionAmount}
						amountLabel={
							isSubscribe ? "Amount to subscribe" : "Amount to redeem"
						}
						ticker={inTicker}
						balance={balance}
						balanceLabel={balanceLabel}
						estimate={{
							label: isSubscribe ? "Estimated shares" : "Estimated proceeds",
							value: estimateValue,
						}}
						submitLabel={isSubscribe ? "Subscribe" : "Redeem"}
						onSubmit={() => setActionAmount("")}
						block={block}
					/>
				</aside>
			</div>
		</div>
	)
}

export default VaultPreview

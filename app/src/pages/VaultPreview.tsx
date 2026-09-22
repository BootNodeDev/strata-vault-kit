import { formatAmount, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import Copy from "../components/icons/Copy"
import AboutVault, { type FigureGroup } from "../components/vault/AboutVault"
import ActionPanel, {
	type ActionPanelSide,
} from "../components/vault/ActionPanel"
import MetricsStrip, { type Metric } from "../components/vault/MetricsStrip"
import PositionCard from "../components/vault/PositionCard"
import {
	partitionByStage,
	type RequestEntry,
	type RequestStage,
} from "../components/vault/RequestCard"
import RequestList, { type RequestGroup } from "../components/vault/RequestList"
import { contractRows, vaultContractId } from "../config/contracts"
import { useVaultAuthorities } from "../hooks/useVaultAuthorities"
import { useVaultFigures } from "../hooks/useVaultFigures"
import typeStyles from "../styles/type.module.css"
import { toAuthorityRows, toMetrics, toSizeFigures } from "./vaultMetrics"
import styles from "./VaultPreview.module.css"

const vaultName = "Operator vault name"

const shareNav = 1.0342
const tokenBalance = 2450
const shareBalance = 1000

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

const sharePriceMetric: Metric = {
	label: "Share price",
	value: "1.0342",
	note: "NAV of 31 Aug 2026",
}

const claimableEntry: RequestEntry = {
	id: 4,
	inLabel: "Subscription",
	inAmount: "1,000.00 TOKEN",
	inMeta: "Requested 5 Sep 2026",
	outLabel: "You claim",
	outAmount: "966.93 vTOKEN",
	outMeta: "Priced 5 Sep 2026",
	outTone: "ok",
	state: "Claimable",
	tone: "claimable",
	actions: [{ label: "Claim", kind: "primary", onPress: () => {} }],
}

const waitingEntry: RequestEntry = {
	id: 3,
	inLabel: "Redemption",
	inAmount: "12,000.00 vTOKEN",
	inMeta: "Requested 28 Aug 2026",
	outLabel: "Owed to you",
	outAmount: "12,348.00 TOKEN",
	outMeta: "Priced 5 Sep 2026",
	state: "Priced",
	tone: "blocked",
	actions: [{ label: "Claim", kind: "unavailable", onPress: () => {} }],
	tooltip: {
		label: "Why you cannot claim this yet",
		text: "Your price will not change. A claim becomes claimable once the reserve covers its full amount: it covers 4,200.00 TOKEN of this claim and 8,148.00 TOKEN is still needed. The reserve is not held for this claim: the first uncovered claim submitted takes it. Awaiting a top-up, with no date promised.",
	},
}

const openEntries: RequestEntry[] = [
	{
		id: 1,
		inLabel: "Subscription",
		inAmount: "1,000.00 TOKEN",
		inMeta: "Requested 10 Sep 2026",
		outLabel: "",
		outAmount: "≈ 966.93 vTOKEN",
		outTone: "word",
		state: "Request",
		tone: "pending",
		actions: [{ label: "Cancel request", kind: "ordinary", onPress: () => {} }],
	},
	{
		id: 2,
		inLabel: "Redemption",
		inAmount: "500.00 vTOKEN",
		inMeta: "Requested —",
		outLabel: "",
		outAmount: "≈ 517.10 TOKEN",
		outTone: "word",
		state: "Request",
		tone: "pending",
		actions: [
			{ label: "Cancelling ended", kind: "unavailable", onPress: () => {} },
		],
	},
]

const requestEntries: RequestEntry[] = [
	claimableEntry,
	waitingEntry,
	...openEntries,
]

const stagedRequests = partitionByStage(requestEntries)

const initialStage: RequestStage =
	stagedRequests.ready.length === 0 && stagedRequests.waiting.length > 0
		? "waiting"
		: "ready"

const requestGroups: [RequestGroup, RequestGroup] = [
	{
		id: "ready",
		label: "Ready to claim",
		entries: stagedRequests.ready,
		emptyMessage:
			"Nothing to claim yet. A request appears here once it is priced, and for cash, once the reserve covers it in full.",
	},
	{
		id: "waiting",
		label: "Waiting",
		entries: stagedRequests.waiting,
		emptyMessage:
			"Nothing is waiting. A request you make appears here until it is claimable.",
	},
]

const VaultPreview: React.FC = () => {
	const [openTooltipId, setOpenTooltipId] = React.useState<
		string | number | null
	>(null)
	const [activeStage, setActiveStage] =
		React.useState<RequestStage>(initialStage)
	const [copied, setCopied] = React.useState(false)
	const [actionSide, setActionSide] =
		React.useState<ActionPanelSide>("subscribe")
	const [actionAmount, setActionAmount] = React.useState("")

	const { figures, isPending: isPendingFigures } = useVaultFigures()
	const { authorities, isPending: isPendingAuthorities } = useVaultAuthorities()
	const metrics: [Metric, Metric, Metric, Metric] = [
		sharePriceMetric,
		...toMetrics(figures, isPendingFigures),
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
	const inTicker = isSubscribe ? "TOKEN" : "vTOKEN"
	const outTicker = isSubscribe ? "vTOKEN" : "TOKEN"
	const balance = isSubscribe ? tokenBalance : shareBalance
	const parsedAmount = parseAmount(actionAmount)
	const estimateValue =
		parsedAmount === null
			? "≈ —"
			: `≈ ${formatAmount(
					isSubscribe ? parsedAmount / shareNav : parsedAmount * shareNav,
				)} ${outTicker}`
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
				<h1 className={typeStyles.vaultName}>{vaultName}</h1>
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
							value="1,000.00 vTOKEN"
							sub="In your wallet"
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
						balanceLabel={`Balance ${formatAmount(balance)}`}
						estimate={{
							label: isSubscribe ? "Estimated shares" : "Estimated proceeds",
							value: estimateValue,
						}}
						submitLabel={isSubscribe ? "Subscribe" : "Redeem"}
						onSubmit={() => setActionAmount("")}
					/>
				</aside>
			</div>
		</div>
	)
}

export default VaultPreview

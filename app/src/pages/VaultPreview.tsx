import { formatAmount, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import Copy from "../components/icons/Copy"
import AboutVault, { type AddressRow } from "../components/vault/AboutVault"
import ActionPanel, {
	type ActionPanelSide,
} from "../components/vault/ActionPanel"
import LifecyclePanel, {
	type LifecycleStep,
} from "../components/vault/LifecyclePanel"
import MetricsStrip, { type Metric } from "../components/vault/MetricsStrip"
import PositionCard from "../components/vault/PositionCard"
import { type RequestEntry } from "../components/vault/RequestCard"
import RequestList from "../components/vault/RequestList"
import { contractRows, vaultContractId } from "../config/contracts"
import typeStyles from "../styles/type.module.css"
import styles from "./VaultPreview.module.css"

const vaultName = "Operator vault name"

const shareNav = 1.0342
const tokenBalance = 2450
const shareBalance = 1000

const sections: { id: string; label: string }[] = [
	{ id: "requests", label: "Requests" },
	{ id: "position", label: "Position" },
	{ id: "lifecycle", label: "Lifecycle" },
	{ id: "about", label: "About" },
]

const vaultSummary =
	"Shares in this vault are a claim on an off-chain asset whose NAV is published on chain by an oracle. No price exists at the moment you act, so entry and exit are requests: what you put in is locked, and its batch is priced once the oracle can price it. Pricing does not wait for cash. The debt is recorded at the attested price, and each claim becomes claimable once the reserve covers it in full, in any order rather than by queue position."

// TODO: read these from the vault, which exposes one public view per row.
const authorityRows: AddressRow[] = [
	{ label: "Governance", source: "placeholder" },
	{ label: "Manager", source: "placeholder" },
	{ label: "Treasury", source: "placeholder" },
	{ label: "Guardian", source: "placeholder" },
	{ label: "Custodian", source: "placeholder" },
]

const parseAmount = (raw: string): number | null => {
	const value = Number(raw.replace(/,/g, ""))
	return Number.isFinite(value) && value > 0 ? value : null
}

const metrics: [Metric, Metric, Metric, Metric] = [
	{ label: "Share price", value: "1.0342", note: "NAV of 31 Aug 2026" },
	{
		label: "Liquid reserve",
		value: "18,400.00",
		note: "TOKEN the vault holds now",
	},
	{
		label: "Committed",
		value: "6,200.00",
		note: "TOKEN owed on priced claims",
	},
	{
		label: "Uncovered · vault",
		value: "0.00",
		note: "Every claim is covered",
	},
]

const settlementSteps: LifecycleStep[] = [
	{
		title: "Request",
		actor: "YOU",
		body: "Your TOKEN or shares are locked in the batch that is open. One request per side per batch.",
	},
	{
		title: "Priced",
		actor: "THE ORACLE",
		body: "The batch is closed, then priced as soon as the oracle can price it. One price for everyone in it.",
	},
	{
		title: "Claimable",
		actor: "THE VAULT",
		body: "A share claim is claimable at once. A cash claim waits for the reserve to cover it in full.",
	},
	{
		title: "Claimed",
		actor: "YOU",
		body: "You take the shares or the cash. Shares need an allowlisted address, cash does not.",
	},
]

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
	state: "Awaiting liquidity",
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
		state: "Pending",
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
		state: "Pending",
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

const VaultPreview: React.FC = () => {
	const [openTooltipId, setOpenTooltipId] = React.useState<
		string | number | null
	>(null)
	const [copied, setCopied] = React.useState(false)
	const [actionSide, setActionSide] =
		React.useState<ActionPanelSide>("subscribe")
	const [actionAmount, setActionAmount] = React.useState("")

	const toggleTooltip = (id: string | number) => {
		setOpenTooltipId((current) => (current === id ? null : id))
	}

	const changeActionSide = (side: ActionPanelSide) => {
		setActionSide(side)
		setActionAmount("")
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
							countLabel={(open) => `${open} open`}
							entries={requestEntries}
							emptyMessage="Your requests appear here."
							openTooltipId={openTooltipId}
							onToggleTooltip={toggleTooltip}
						/>
					</div>

					<section
						id="position"
						className={`${styles.section} ${styles.anchor}`}
					>
						<h2 className={typeStyles.sectionHead}>Your position</h2>
						<PositionCard
							label="Your shares"
							value="1,000.00 vTOKEN"
							sub="In your wallet"
						/>
					</section>

					<div id="lifecycle" className={styles.anchor}>
						<LifecyclePanel
							title="How a request settles"
							progress="Every request, both sides"
							steps={settlementSteps}
							currentStep={null}
						/>
					</div>

					<div id="about" className={styles.anchor}>
						<AboutVault
							summary={vaultSummary}
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

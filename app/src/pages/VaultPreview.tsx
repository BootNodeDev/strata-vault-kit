import React from "react"
import LifecyclePanel, {
	type LifecycleStep,
} from "../components/vault/LifecyclePanel"
import MetricsStrip, { type Metric } from "../components/vault/MetricsStrip"
import PositionCard from "../components/vault/PositionCard"
import { type RequestEntry } from "../components/vault/RequestCard"
import RequestList from "../components/vault/RequestList"
import typeStyles from "../styles/type.module.css"
import styles from "./VaultPreview.module.css"

const vaultName = "Operator vault name"
const vaultAddress = "CB4AQ7XKPMWQ4ZDXKR2NHVUJZ9F49K2T"

const shortenAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

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
	tooltip: {
		label: "What claiming does",
		text: "All or nothing: a claim has no amount field. A priced claim is never re-priced and does not expire.",
	},
}

const waitingEntry: RequestEntry = {
	id: 3,
	inLabel: "Redemption",
	inAmount: "12,000.00 vTOKEN",
	inMeta: "Requested 28 Aug 2026",
	outLabel: "Owed to you",
	outAmount: "12,348.00 TOKEN",
	outMeta: "Priced 5 Sep 2026",
	state: "Not payable yet",
	tone: "blocked",
	actions: [{ label: "Claim", kind: "unavailable", onPress: () => {} }],
	tooltip: {
		label: "Why you cannot claim this yet",
		text: "Your price will not change. A claim pays once the reserve covers its full amount: it covers 4,200.00 TOKEN of this claim and 8,148.00 TOKEN is still needed. Awaiting a top-up, with no date promised.",
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

	const toggleTooltip = (id: string | number) => {
		setOpenTooltipId((current) => (current === id ? null : id))
	}

	const copyAddress = async () => {
		try {
			await navigator.clipboard.writeText(vaultAddress)
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
						{shortenAddress(vaultAddress)}
					</span>
					<button
						type="button"
						className={`${typeStyles.label} ${styles.copyButton}`}
						onClick={copyAddress}
					>
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
			</div>

			<MetricsStrip metrics={metrics} />

			<div className={styles.body}>
				<div className={styles.main}>
					<RequestList
						heading="Your requests"
						countLabel={(open) => `${open} open`}
						entries={requestEntries}
						emptyMessage="Your requests appear here."
						banner={{
							label: "Two claims are racing",
							body: "The reserve is not held for a claim: the first uncovered claim submitted takes it.",
						}}
						openTooltipId={openTooltipId}
						onToggleTooltip={toggleTooltip}
					/>

					<section className={styles.section}>
						<h2 className={typeStyles.sectionHead}>Your position</h2>
						<PositionCard
							label="Your shares"
							value="1,000.00 vTOKEN"
							sub="In your wallet"
						/>
					</section>

					<LifecyclePanel
						title="How a request settles"
						progress="Every request, both sides"
						steps={settlementSteps}
						currentStep={null}
					/>
				</div>

				<aside className={styles.side} aria-label="Actions" />
			</div>
		</div>
	)
}

export default VaultPreview

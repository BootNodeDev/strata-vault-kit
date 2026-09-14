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

const unreadMetrics = metrics.map((metric) => ({
	...metric,
	value: null,
	note: "Not read",
})) as [Metric, Metric, Metric, Metric]

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
		outLabel: "Estimated",
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
		outLabel: "Estimated",
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

	const toggleTooltip = (id: string | number) => {
		setOpenTooltipId((current) => (current === id ? null : id))
	}

	return (
		<div className={styles.page}>
			<div>
				<h1 className={typeStyles.vaultName}>Component preview</h1>
				<p className={`${typeStyles.body} ${styles.intro}`}>
					Static props, no wallet and no contract reads. This page exists to
					review the vault components while the data layer is built.
				</p>
			</div>

			<section className={styles.section}>
				<h2 className={typeStyles.sectionHead}>Metrics strip</h2>
				<MetricsStrip metrics={metrics} />
				<p className={`${typeStyles.footnote} ${styles.caption}`}>
					Every figure unreadable
				</p>
				<MetricsStrip metrics={unreadMetrics} />
			</section>

			<section className={styles.section}>
				<h2 className={typeStyles.sectionHead}>Lifecycle panel</h2>
				<LifecyclePanel
					title="How a request settles"
					progress="Step 2 of 4"
					steps={settlementSteps}
					currentStep={2}
				/>
				<p className={`${typeStyles.footnote} ${styles.caption}`}>
					Narrow enough to stack
				</p>
				<div className={styles.pair}>
					<LifecyclePanel
						title="How a request settles"
						progress="Claimed"
						steps={settlementSteps}
						currentStep="complete"
					/>
				</div>
			</section>

			<section className={styles.section}>
				<h2 className={typeStyles.sectionHead}>Position card</h2>
				<div className={styles.pair}>
					<PositionCard
						label="Your shares"
						value="1,000.00 vTOKEN"
						sub="In your wallet"
					/>
					<PositionCard
						label="Your shares"
						value={null}
						sub="Not read"
						note="No shares exist for this request yet"
					/>
				</div>
			</section>

			<section className={styles.section}>
				<h2 className={typeStyles.sectionHead}>Request list</h2>
				<RequestList
					heading="Your open requests"
					count="4 open"
					entries={requestEntries}
					emptyMessage="Your requests appear here."
					banner={{
						label: "Two claims are racing",
						body: "The reserve is not held for a claim: the first uncovered claim submitted takes it.",
					}}
					openTooltipId={openTooltipId}
					onToggleTooltip={toggleTooltip}
				/>
				<RequestList
					heading="Your open requests"
					count="0 open"
					entries={[]}
					emptyMessage="Your requests appear here."
					openTooltipId={openTooltipId}
					onToggleTooltip={toggleTooltip}
				/>
			</section>
		</div>
	)
}

export default VaultPreview

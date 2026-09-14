import React from "react"
import LifecyclePanel, {
	type LifecycleStep,
} from "../components/vault/LifecyclePanel"
import MetricsStrip, { type Metric } from "../components/vault/MetricsStrip"
import PositionCard from "../components/vault/PositionCard"
import { type RequestEntry } from "../components/vault/RequestCard"
import RequestList, { type RequestGroup } from "../components/vault/RequestList"
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
	title: "Subscription",
	state: "Claimable",
	tone: "claimable",
	rows: [
		{ label: "You claim", value: "966.93 vTOKEN", tone: "ok" },
		{ label: "Priced at", value: "1.0342 · 5 Sep 2026" },
		{ label: "Locked and consumed", value: "1,000.00 TOKEN" },
	],
	actions: [
		{ label: "Claim 966.93 vTOKEN", kind: "primary", onPress: () => {} },
	],
	foot: "All or nothing. A claim has no amount field.",
}

const waitingEntry: RequestEntry = {
	id: 3,
	title: "Redemption",
	state: "Priced · not payable yet",
	tone: "blocked",
	rows: [
		{ label: "Priced at", value: "1.0290 · 5 Sep 2026" },
		{ label: "Locked and consumed", value: "12,000.00 vTOKEN" },
	],
	coverage: {
		label: "This claim",
		rows: [
			{ label: "Owed to you", value: "12,348.00 TOKEN" },
			{ label: "Reserve covers", value: "4,200.00 TOKEN" },
			{ label: "Still needed", value: "8,148.00 TOKEN", tone: "stop" },
		],
	},
	note: "Your price will not change. A claim pays once the reserve covers its full amount, so this one waits for a top-up.",
	actions: [
		{
			label: "Claim (reserve does not cover this yet)",
			kind: "unavailable",
			onPress: () => {},
		},
	],
	foot: "Awaiting a top-up. No date is promised.",
}

const openEntries: RequestEntry[] = [
	{
		id: 1,
		title: "Subscription",
		state: "Pending",
		tone: "pending",
		rows: [
			{ label: "Locked", value: "1,000.00 TOKEN" },
			{ label: "Requested", value: "10 Sep 2026" },
			{ label: "Estimated", value: "≈ 966.93 vTOKEN", tone: "word" },
		],
		actions: [
			{ label: "Cancel this request", kind: "ordinary", onPress: () => {} },
		],
	},
	{
		id: 2,
		title: "Redemption",
		state: "Pending",
		tone: "pending",
		rows: [
			{ label: "Locked", value: "500.00 vTOKEN" },
			{ label: "Requested", value: "—" },
			{ label: "Estimated", value: "≈ 517.10 TOKEN", tone: "word" },
		],
		note: "Its batch has closed and the oracle can price it, so your price is already readable. Cancelling ended there.",
		actions: [
			{ label: "Cancelling ended", kind: "unavailable", onPress: () => {} },
		],
	},
]

const requestGroups: RequestGroup[] = [
	{
		heading: "Ready to claim",
		caption: "priced and covered",
		entries: [claimableEntry],
	},
	{
		heading: "Waiting",
		caption: "priced, not claimable yet",
		entries: [waitingEntry],
	},
	{ heading: "Open", caption: "not priced yet", entries: openEntries },
]

const emptyRequestGroups: RequestGroup[] = [
	{ heading: "Ready to claim", caption: "priced and covered", entries: [] },
	{ heading: "Waiting", caption: "priced, not claimable yet", entries: [] },
	{ heading: "Open", caption: "not priced yet", entries: [] },
]

const VaultPreview: React.FC = () => (
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
				groups={requestGroups}
				emptyMessage="Your requests appear here."
				banner={{
					label: "Two claims are racing",
					body: "The reserve is not held for a claim: the first uncovered claim submitted takes it.",
				}}
			/>
			<RequestList
				heading="Your open requests"
				count="0 open"
				groups={emptyRequestGroups}
				emptyMessage="Your requests appear here."
			/>
		</section>
	</div>
)

export default VaultPreview

import React from "react"
import LifecyclePanel, {
	type LifecycleStep,
} from "../components/vault/LifecyclePanel"
import MetricsStrip, { type Metric } from "../components/vault/MetricsStrip"
import typeStyles from "../styles/type.module.css"
import styles from "./VaultPreview.module.css"

const metrics: [Metric, Metric, Metric, Metric] = [
	{
		label: "Net assets",
		value: "23,310.00",
		note: "On-chain reserve + custodian",
	},
	{
		label: "Total supply",
		value: "22,539.16",
		note: "vTOKEN issued, escrow included",
	},
	{ label: "Share price", value: "1.0342", note: "Attested 31 Aug 2026" },
	{ label: "Open epoch", value: "E-18", note: "Takes new requests" },
]

const unreadMetrics = metrics.map((metric) => ({
	...metric,
	value: null,
	note: "Not read",
})) as [Metric, Metric, Metric, Metric]

const subscribeSteps: [LifecycleStep, LifecycleStep, LifecycleStep] = [
	{
		title: "Request subscription",
		actor: "YOU",
		body: "Your TOKEN joins the open epoch and sits in escrow.",
	},
	{
		title: "Priced",
		actor: "NEXT ATTESTATION",
		body: "The epoch is sealed, then priced at the next attested value.",
	},
	{
		title: "Claim your shares",
		actor: "YOU",
		body: "Claim to receive the shares in your wallet.",
	},
]

const redeemSteps: [LifecycleStep, LifecycleStep, LifecycleStep] = [
	{
		title: "Request redemption",
		actor: "YOU",
		body: "Your shares join the open epoch and sit in escrow.",
	},
	{
		title: "Priced",
		actor: "NEXT ATTESTATION",
		body: "The epoch is sealed, then priced once the treasury covers it.",
	},
	{
		title: "Claim your TOKEN",
		actor: "YOU",
		body: "Claim to receive the cash in your wallet.",
	},
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
			<div className={styles.pair}>
				<LifecyclePanel
					title="Subscription lifecycle"
					progress="Step 2 of 3"
					steps={subscribeSteps}
					currentStep={2}
				/>
				<LifecyclePanel
					title="Redemption lifecycle"
					progress="Nothing open"
					steps={redeemSteps}
					currentStep={null}
				/>
			</div>
		</section>
	</div>
)

export default VaultPreview

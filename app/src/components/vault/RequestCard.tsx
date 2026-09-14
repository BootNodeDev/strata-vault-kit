import React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./RequestCard.module.css"

export type RequestRow = {
	label: string
	value: string | null
	tone?: "value" | "ok" | "word" | "stop"
}

export type RequestActionKind = "primary" | "ordinary" | "unavailable"

export type RequestAction = {
	label: string
	kind: RequestActionKind
	onPress: () => void
}

export type RequestCoverage = {
	label: string
	rows: RequestRow[]
}

export type RequestTone = "pending" | "claimable" | "blocked"

export type RequestEntry = {
	id: string | number
	title: string
	state: string
	tone: RequestTone
	rows: RequestRow[]
	coverage?: RequestCoverage
	note?: string
	foot?: string
	actions: RequestAction[]
}

type RequestCardProps = {
	entry: RequestEntry
}

const rowValueClassName = (tone: RequestRow["tone"]): string => {
	if (tone === "ok") return `${typeStyles.railValue} ${styles.rowOk}`
	if (tone === "word") return `${typeStyles.footnote} ${styles.rowWord}`
	if (tone === "stop") return `${typeStyles.railValue} ${styles.rowStop}`
	return `${typeStyles.railValue} ${styles.rowValue}`
}

const bodyClassName: Record<RequestTone, string> = {
	pending: `${styles.pending}`,
	claimable: `${styles.claimable}`,
	blocked: `${styles.blocked}`,
}

const chipClassName: Record<RequestTone, string> = {
	pending: `${styles.chipPending}`,
	claimable: `${styles.chipClaimable}`,
	blocked: `${styles.chipBlocked}`,
}

const actionClassName: Record<RequestActionKind, string> = {
	primary: `${styles.actionPrimary}`,
	ordinary: `${styles.actionOrdinary}`,
	unavailable: `${styles.actionUnavailable}`,
}

const RequestCard: React.FC<RequestCardProps> = ({ entry }) => (
	<div className={`${styles.body} ${bodyClassName[entry.tone]}`}>
		<div className={styles.heading}>
			<span
				className={`${typeStyles.label} ${styles.chip} ${
					chipClassName[entry.tone]
				}`}
			>
				{entry.state}
			</span>
			<span className={styles.title}>{entry.title}</span>
		</div>
		<div className={styles.rows}>
			{entry.rows.map((row, index) => (
				<div className={styles.row} key={`${index}-${row.label}`}>
					<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
						{row.label}
					</span>
					<span className={rowValueClassName(row.tone)}>
						{row.value ?? "—"}
					</span>
				</div>
			))}
		</div>
		{entry.coverage && (
			<div className={styles.coverage}>
				<span className={`${typeStyles.label} ${styles.coverageLabel}`}>
					{entry.coverage.label}
				</span>
				{entry.coverage.rows.map((row, index) => (
					<div className={styles.row} key={`${index}-${row.label}`}>
						<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
							{row.label}
						</span>
						<span className={rowValueClassName(row.tone)}>
							{row.value ?? "—"}
						</span>
					</div>
				))}
			</div>
		)}
		{entry.note && (
			<p className={`${typeStyles.footnote} ${styles.note}`}>{entry.note}</p>
		)}
		<div className={styles.actions}>
			{entry.actions.map((action, index) => (
				<button
					key={`${index}-${action.label}`}
					type="button"
					className={actionClassName[action.kind]}
					disabled={action.kind === "unavailable"}
					onClick={action.onPress}
				>
					{action.label}
				</button>
			))}
		</div>
		{entry.foot && (
			<span className={`${typeStyles.footnote} ${styles.foot}`}>
				{entry.foot}
			</span>
		)}
	</div>
)

export default RequestCard

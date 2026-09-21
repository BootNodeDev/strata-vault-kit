import React from "react"
import typeStyles from "../../styles/type.module.css"
import Info from "../icons/Info"
import styles from "./RequestCard.module.css"

export type RequestActionKind = "primary" | "ordinary" | "unavailable"

export type RequestAction = {
	label: string
	kind: RequestActionKind
	onPress: () => void
}

export type RequestValueTone = "value" | "ok" | "word" | "stop"

export type RequestTone = "pending" | "claimable" | "blocked"

export type RequestEntry = {
	id: string | number
	inLabel: string
	inAmount: string
	inMeta: string
	outLabel: string
	outAmount: string
	outMeta?: string
	outTone?: RequestValueTone
	state: string
	tone: RequestTone
	actions: RequestAction[]
	tooltip?: { label: string; text: string }
	note?: string
}

export type RequestStage = "ready" | "waiting"

// `tone` is presentational, but it is the only field that separates a claim you
// can take from one still in flight. Issue #84 replaces this map with the real
// request state.
const stageByTone: Record<RequestTone, RequestStage> = {
	pending: "waiting",
	claimable: "ready",
	blocked: "waiting",
}

export const partitionByStage = (
	entries: RequestEntry[],
): Record<RequestStage, RequestEntry[]> => ({
	ready: entries.filter((entry) => stageByTone[entry.tone] === "ready"),
	waiting: entries.filter((entry) => stageByTone[entry.tone] === "waiting"),
})

type RequestCardProps = {
	entry: RequestEntry
	tipOpen: boolean
	onToggleTip: () => void
}

const outValueClassName = (tone: RequestValueTone | undefined): string => {
	if (tone === "ok") return `${typeStyles.summaryValue} ${styles.outOk}`
	if (tone === "stop") return `${typeStyles.summaryValue} ${styles.outStop}`
	if (tone === "word") return `${typeStyles.footnote} ${styles.outWord}`
	return `${typeStyles.summaryValue} ${styles.outValue}`
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

const RequestCard: React.FC<RequestCardProps> = ({
	entry,
	tipOpen,
	onToggleTip,
}) => (
	<div className={`${styles.body} ${bodyClassName[entry.tone]}`}>
		<div className={styles.spine}>
			<div className={styles.column}>
				<span className={styles.inLabel}>{entry.inLabel}</span>
				<span className={typeStyles.railValue}>{entry.inAmount}</span>
				<span className={`${typeStyles.metricSub} ${styles.muted}`}>
					{entry.inMeta}
				</span>
			</div>
			<div className={styles.column}>
				{entry.outLabel && (
					<span className={`${typeStyles.label} ${styles.muted}`}>
						{entry.outLabel}
					</span>
				)}
				<span className={outValueClassName(entry.outTone)}>
					{entry.outAmount}
				</span>
				{entry.outMeta && (
					<span className={`${typeStyles.metricSub} ${styles.muted}`}>
						{entry.outMeta}
					</span>
				)}
			</div>
			<div className={styles.stateColumn}>
				<span
					className={`${typeStyles.label} ${styles.chip} ${
						chipClassName[entry.tone]
					}`}
				>
					{entry.state}
				</span>
			</div>
			<div className={styles.actionColumn}>
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
				{entry.tooltip && (
					<span className={styles.tipWrap}>
						<button
							type="button"
							aria-expanded={tipOpen}
							aria-label={entry.tooltip.label}
							className={styles.tipTrigger}
							onClick={onToggleTip}
						>
							<Info className={styles.tipIcon} />
						</button>
						{tipOpen && (
							<span role="tooltip" className={styles.tooltip}>
								{entry.tooltip.text}
							</span>
						)}
					</span>
				)}
			</div>
		</div>
		{entry.note && (
			<p className={`${typeStyles.footnote} ${styles.note}`}>{entry.note}</p>
		)}
	</div>
)

export default RequestCard

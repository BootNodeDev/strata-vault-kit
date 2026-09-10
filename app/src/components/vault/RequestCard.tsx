import React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./RequestCard.module.css"

export type RequestRow = {
	label: string
	value: string | null
	tone?: "value" | "ok" | "word"
}

export type ActiveRequest = {
	state: string
	side: string
	tone: "pending" | "priced" | "unpayable"
	rows: RequestRow[]
}

type RequestCardProps = {
	title: string
	request: ActiveRequest | null
	emptyMessage: string
}

const rowValueClassName = (tone: RequestRow["tone"]): string => {
	if (tone === "ok") return `${typeStyles.railValue} ${styles.rowOk}`
	if (tone === "word") return `${typeStyles.footnote} ${styles.rowWord}`
	return `${typeStyles.railValue} ${styles.rowValue}`
}

const bodyClassName: Record<ActiveRequest["tone"], string> = {
	pending: `${styles.pending}`,
	priced: `${styles.priced}`,
	unpayable: `${styles.unpayable}`,
}

const chipClassName: Record<ActiveRequest["tone"], string> = {
	pending: `${styles.chipPending}`,
	priced: `${styles.chipPriced}`,
	unpayable: `${styles.chipUnpayable}`,
}

const RequestCard: React.FC<RequestCardProps> = ({
	title,
	request,
	emptyMessage,
}) => (
	<div className={styles.card}>
		<span className={`${typeStyles.label} ${styles.heading}`}>{title}</span>
		{request ? (
			<div className={`${styles.body} ${bodyClassName[request.tone]}`}>
				<div className={styles.top}>
					<span
						className={`${typeStyles.label} ${styles.chip} ${
							chipClassName[request.tone]
						}`}
					>
						{request.state}
					</span>
					<span className={`${typeStyles.footnote} ${styles.side}`}>
						{request.side}
					</span>
				</div>
				{request.rows.map((row) => (
					<div className={styles.row} key={row.label}>
						<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
							{row.label}
						</span>
						<span className={rowValueClassName(row.tone)}>
							{row.value ?? "—"}
						</span>
					</div>
				))}
			</div>
		) : (
			<p className={`${typeStyles.footnote} ${styles.empty}`}>{emptyMessage}</p>
		)}
	</div>
)

export default RequestCard

import React from "react"
import typeStyles from "../../styles/type.module.css"
import RequestCard, { type RequestEntry } from "./RequestCard"
import styles from "./RequestList.module.css"

type RequestListProps = {
	heading: string
	countLabel: (open: number) => string
	entries: RequestEntry[]
	emptyMessage: string
	openTooltipId: string | number | null
	onToggleTooltip: (id: string | number) => void
}

const RequestList: React.FC<RequestListProps> = ({
	heading,
	countLabel,
	entries,
	emptyMessage,
	openTooltipId,
	onToggleTooltip,
}) => (
	<div className={styles.list}>
		<div className={styles.header}>
			<h3 className={`${typeStyles.sectionHead} ${styles.heading}`}>
				{heading}
			</h3>
			<span className={`${typeStyles.footnote} ${styles.count}`}>
				{countLabel(entries.length)}
			</span>
		</div>
		{entries.length > 0 ? (
			entries.map((entry) => (
				<RequestCard
					key={entry.id}
					entry={entry}
					tipOpen={openTooltipId === entry.id}
					onToggleTip={() => onToggleTooltip(entry.id)}
				/>
			))
		) : (
			<p className={`${typeStyles.footnote} ${styles.empty}`}>{emptyMessage}</p>
		)}
	</div>
)

export default RequestList

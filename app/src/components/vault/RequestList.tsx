import React from "react"
import typeStyles from "../../styles/type.module.css"
import RequestCard, { type RequestEntry } from "./RequestCard"
import styles from "./RequestList.module.css"

export type RequestListBanner = {
	label: string
	body: string
}

type RequestListProps = {
	heading: string
	count: string
	entries: RequestEntry[]
	emptyMessage: string
	banner?: RequestListBanner
	openTooltipId: string | number | null
	onToggleTooltip: (id: string | number) => void
}

const RequestList: React.FC<RequestListProps> = ({
	heading,
	count,
	entries,
	emptyMessage,
	banner,
	openTooltipId,
	onToggleTooltip,
}) => (
	<div className={styles.list}>
		<div className={styles.header}>
			<h3 className={`${typeStyles.sectionHead} ${styles.heading}`}>
				{heading}
			</h3>
			<span className={`${typeStyles.footnote} ${styles.count}`}>{count}</span>
		</div>
		{banner && (
			<div className={styles.banner}>
				<span className={`${typeStyles.label} ${styles.bannerLabel}`}>
					{banner.label}
				</span>
				<p className={`${typeStyles.body} ${styles.bannerBody}`}>
					{banner.body}
				</p>
			</div>
		)}
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

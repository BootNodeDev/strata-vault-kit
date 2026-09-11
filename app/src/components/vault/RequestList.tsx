import React from "react"
import typeStyles from "../../styles/type.module.css"
import RequestCard, { type RequestEntry } from "./RequestCard"
import styles from "./RequestList.module.css"

export type RequestListBanner = {
	label: string
	body: string
}

export type RequestGroup = {
	heading: string
	caption: string
	entries: RequestEntry[]
}

type RequestListProps = {
	heading: string
	count: string
	groups: RequestGroup[]
	emptyMessage: string
	banner?: RequestListBanner
}

const RequestList: React.FC<RequestListProps> = ({
	heading,
	count,
	groups,
	emptyMessage,
	banner,
}) => {
	const hasEntries = groups.some((group) => group.entries.length > 0)

	return (
		<div className={styles.list}>
			<div className={styles.header}>
				<h2 className={`${typeStyles.sectionHead} ${styles.heading}`}>
					{heading}
				</h2>
				<span className={`${typeStyles.footnote} ${styles.count}`}>
					{count}
				</span>
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
			{hasEntries ? (
				groups.map((group) =>
					group.entries.length > 0 ? (
						<div className={styles.group} key={group.heading}>
							<div className={styles.groupHeader}>
								<span className={`${typeStyles.label} ${styles.groupLabel}`}>
									{group.heading}
								</span>
								<span className={styles.groupCaption}>{group.caption}</span>
							</div>
							{group.entries.map((entry) => (
								<RequestCard key={entry.id} entry={entry} />
							))}
						</div>
					) : null,
				)
			) : (
				<p className={`${typeStyles.footnote} ${styles.empty}`}>
					{emptyMessage}
				</p>
			)}
		</div>
	)
}

export default RequestList

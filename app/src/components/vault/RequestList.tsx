import React from "react"
import typeStyles from "../../styles/type.module.css"
import RequestCard, {
	type RequestEntry,
	type RequestStage,
} from "./RequestCard"
import styles from "./RequestList.module.css"

export type RequestGroup = {
	id: RequestStage
	label: string
	entries: RequestEntry[]
	emptyMessage: string
}

type RequestListProps = {
	heading: string
	groups: [RequestGroup, RequestGroup]
	activeStage: RequestStage
	onStageChange: (stage: RequestStage) => void
	openTooltipId: string | number | null
	onToggleTooltip: (id: string | number) => void
}

const RequestList: React.FC<RequestListProps> = ({
	heading,
	groups,
	activeStage,
	onStageChange,
	openTooltipId,
	onToggleTooltip,
}) => {
	const tabRefs = React.useRef<Record<RequestStage, HTMLButtonElement | null>>({
		ready: null,
		waiting: null,
	})

	const selectTab = (group: RequestGroup) => {
		onStageChange(group.id)
		tabRefs.current[group.id]?.focus()
	}

	const onTabKeyDown = (
		event: React.KeyboardEvent<HTMLButtonElement>,
		group: RequestGroup,
	) => {
		const [first, last] = groups
		if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
			event.preventDefault()
			selectTab(group === first ? last : first)
			return
		}
		if (event.key === "Home") {
			event.preventDefault()
			selectTab(first)
			return
		}
		if (event.key === "End") {
			event.preventDefault()
			selectTab(last)
		}
	}

	const [first, last] = groups
	const activeGroup = first.id === activeStage ? first : last

	return (
		<div className={styles.list}>
			<h3 className={`${typeStyles.sectionHead} ${styles.heading}`}>
				{heading}
			</h3>
			<div role="tablist" aria-label="Request stages" className={styles.tabs}>
				{groups.map((group) => {
					const isActive = group.id === activeStage
					return (
						<button
							key={group.id}
							type="button"
							role="tab"
							id={`request-tab-${group.id}`}
							aria-selected={isActive}
							aria-controls={isActive ? `request-panel-${group.id}` : undefined}
							tabIndex={isActive ? 0 : -1}
							ref={(node) => {
								tabRefs.current[group.id] = node
							}}
							className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
							onClick={() => selectTab(group)}
							onKeyDown={(event) => onTabKeyDown(event, group)}
						>
							{group.label}{" "}
							<span className={styles.tabCount}>{group.entries.length}</span>
						</button>
					)
				})}
			</div>
			<div
				role="tabpanel"
				id={`request-panel-${activeGroup.id}`}
				aria-labelledby={`request-tab-${activeGroup.id}`}
				tabIndex={0}
				className={styles.panel}
			>
				{activeGroup.entries.length > 0 ? (
					activeGroup.entries.map((entry) => (
						<RequestCard
							key={entry.id}
							entry={entry}
							tipOpen={openTooltipId === entry.id}
							onToggleTip={() => onToggleTooltip(entry.id)}
						/>
					))
				) : (
					<p className={`${typeStyles.footnote} ${styles.empty}`}>
						{activeGroup.emptyMessage}
					</p>
				)}
			</div>
		</div>
	)
}

export default RequestList

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
	groups: [RequestGroup, ...RequestGroup[]]
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
	const instanceId = React.useId()
	const tabId = (stage: RequestStage) => `${instanceId}-tab-${stage}`
	const panelId = (stage: RequestStage) => `${instanceId}-panel-${stage}`

	const selectTab = (group: RequestGroup) => {
		onStageChange(group.id)
		document.getElementById(tabId(group.id))?.focus()
	}

	const groupAt = (index: number): RequestGroup =>
		groups[((index % groups.length) + groups.length) % groups.length] ??
		groups[0]

	const onTabKeyDown = (
		event: React.KeyboardEvent<HTMLButtonElement>,
		index: number,
	) => {
		if (event.key === "ArrowRight") {
			event.preventDefault()
			selectTab(groupAt(index + 1))
			return
		}
		if (event.key === "ArrowLeft") {
			event.preventDefault()
			selectTab(groupAt(index - 1))
			return
		}
		if (event.key === "Home") {
			event.preventDefault()
			selectTab(groups[0])
			return
		}
		if (event.key === "End") {
			event.preventDefault()
			selectTab(groupAt(-1))
		}
	}

	const activeGroup =
		groups.find((group) => group.id === activeStage) ?? groups[0]

	return (
		<div className={styles.list}>
			<h3 className={`${typeStyles.sectionHead} ${styles.heading}`}>
				{heading}
			</h3>
			<div role="tablist" aria-label="Request stages" className={styles.tabs}>
				{groups.map((group, index) => {
					const isActive = group.id === activeStage
					return (
						<button
							key={group.id}
							type="button"
							role="tab"
							id={tabId(group.id)}
							aria-selected={isActive}
							aria-controls={isActive ? panelId(group.id) : undefined}
							tabIndex={isActive ? 0 : -1}
							className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
							onClick={() => selectTab(group)}
							onKeyDown={(event) => onTabKeyDown(event, index)}
						>
							{group.label}{" "}
							<span className={styles.tabCount}>{group.entries.length}</span>
						</button>
					)
				})}
			</div>
			<div
				role="tabpanel"
				id={panelId(activeGroup.id)}
				aria-labelledby={tabId(activeGroup.id)}
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

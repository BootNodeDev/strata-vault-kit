import React, { useState } from "react"
import {
	type ActionField as ActionFieldSpec,
	type Condition,
	type CycleAction,
	type CycleActionId,
	type Readiness,
	readiness,
	readyCount,
} from "../../pages/cycle"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import styles from "./CycleActionRail.module.css"

type OnInput = (action: CycleAction, value: string) => void

const conditionValue = (condition: Condition): string => {
	if (condition.met === null) return "—"
	return condition.detail ?? (condition.met ? "Met" : "Not met")
}

const summaryOf = (state: Readiness): string => {
	if (state.kind === "ready") return "Ready"
	if (state.kind === "unavailable") return "Unavailable"
	return `${state.count} unmet`
}

const ActionField: React.FC<{
	action: CycleAction
	field: ActionFieldSpec
	onInput: OnInput | undefined
}> = ({ action, field, onInput }) => {
	const id = `cycle-${action.id}-field`
	return (
		<div className={field.invalid ? styles.fieldOver : styles.field}>
			<label htmlFor={id} className={styles.srOnly}>
				{field.label}
			</label>
			<input
				id={id}
				className={`${typeStyles.amountInput} ${styles.fieldInput}`}
				value={field.value}
				onChange={(event) => onInput?.(action, event.target.value)}
				placeholder={field.placeholder}
				inputMode="decimal"
			/>
			{field.max !== undefined && (
				<button
					type="button"
					className={styles.useMax}
					onClick={() => onInput?.(action, field.max ?? "")}
				>
					Use max
				</button>
			)}
		</div>
	)
}

const ActionBody: React.FC<{
	action: CycleAction
	onRun: (action: CycleAction) => void
	onInput: OnInput | undefined
}> = ({ action, onRun, onInput }) => (
	<>
		{action.field !== undefined && (
			<ActionField action={action} field={action.field} onInput={onInput} />
		)}
		<ul aria-label={`${action.label} conditions`} className={styles.conditions}>
			{action.conditions.map((condition) => (
				<li className={styles.condition} key={condition.label}>
					<span className={`${typeStyles.footnote} ${styles.conditionLabel}`}>
						{condition.label}
					</span>
					<span
						className={`${typeStyles.railValue} ${
							condition.met ? styles.met : styles.unmet
						}`}
					>
						{conditionValue(condition)}
					</span>
				</li>
			))}
		</ul>
		{action.note !== undefined && (
			<p className={`${typeStyles.footnote} ${styles.note}`}>{action.note}</p>
		)}
		{action.outcome !== null && (
			<p className={`${typeStyles.footnote} ${styles.outcome}`}>
				{action.outcome}
			</p>
		)}
		<button
			type="button"
			className={
				action.enabled ? styles.actionPrimary : styles.actionUnavailable
			}
			disabled={!action.enabled}
			onClick={() => onRun(action)}
		>
			{action.label}
		</button>
		{action.unavailable !== undefined && (
			<p className={`${typeStyles.footnote} ${styles.note}`}>
				{action.unavailable}
			</p>
		)}
	</>
)

const CycleActionRail: React.FC<{
	actions: CycleAction[]
	pending: boolean
	onRun: (action: CycleAction) => void
	onInput?: OnInput
}> = ({ actions, pending, onRun, onInput }) => {
	const [open, setOpen] = useState<CycleActionId | null | undefined>()
	if (open === undefined && actions.length > 0)
		setOpen(actions.find((action) => action.enabled)?.id ?? null)

	return (
		<div className={styles.panel}>
			<div className={styles.head}>
				<h3 className={`${typeStyles.sectionHead} ${styles.heading}`}>
					Actions
				</h3>
				{actions.length > 0 && (
					<span className={`${typeStyles.label} ${styles.count}`}>
						{readyCount(actions)} of {actions.length} ready
					</span>
				)}
			</div>
			{actions.length === 0 &&
				(pending ? (
					<Skeleton className={styles.skeleton} />
				) : (
					<p className={`${typeStyles.footnote} ${styles.note}`}>
						No actions available.
					</p>
				))}
			{actions.length > 0 && (
				<ul className={styles.list}>
					{actions.map((action) => {
						const state = readiness(action)
						const expanded = open === action.id
						const id = `cycle-${action.id}-action`
						return (
							<li className={styles.item} key={action.id}>
								<button
									type="button"
									className={styles.toggle}
									aria-expanded={expanded}
									aria-controls={id}
									aria-labelledby={`${id}-label`}
									aria-describedby={`${id}-summary`}
									onClick={() => setOpen(expanded ? null : action.id)}
								>
									<span
										aria-hidden="true"
										className={
											state.kind === "ready"
												? styles.markerReady
												: styles.marker
										}
									/>
									<span
										id={`${id}-label`}
										className={`${typeStyles.body} ${styles.toggleLabel}`}
									>
										{action.label}
									</span>
									<span
										id={`${id}-summary`}
										className={`${typeStyles.footnote} ${styles.summary}`}
									>
										{summaryOf(state)}
									</span>
								</button>
								<div id={id} className={styles.body} hidden={!expanded}>
									<ActionBody action={action} onRun={onRun} onInput={onInput} />
								</div>
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}

export default CycleActionRail

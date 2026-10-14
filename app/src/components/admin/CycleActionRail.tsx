import React, { useState } from "react"
import {
	type ActionField as ActionFieldSpec,
	type Condition,
	type RailAction,
	type Readiness,
	readiness,
	readyCount,
} from "../../pages/actions"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import styles from "./CycleActionRail.module.css"

type OnInput<A> = (action: A, value: string) => void

const conditionValue = (condition: Condition): string => {
	if (condition.met === null) return "—"
	return condition.detail ?? (condition.met ? "Met" : "Not met")
}

const summaryOf = (state: Readiness): string => {
	if (state.kind === "ready") return "Ready"
	if (state.kind === "unavailable") return "Unavailable"
	return `${state.count} unmet`
}

function ActionField<A extends RailAction>({
	id,
	action,
	field,
	onInput,
}: {
	id: string
	action: A
	field: ActionFieldSpec
	onInput: OnInput<A> | undefined
}) {
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

const buttonClass = (action: RailAction): string | undefined => {
	if (!action.enabled) return styles.actionUnavailable
	return action.tone === "danger" ? styles.actionDanger : styles.actionPrimary
}

function ActionBody<A extends RailAction>({
	fieldId,
	action,
	onRun,
	onInput,
}: {
	fieldId: string
	action: A
	onRun: (action: A) => void
	onInput: OnInput<A> | undefined
}) {
	return (
		<>
			{action.field !== undefined && (
				<ActionField
					id={fieldId}
					action={action}
					field={action.field}
					onInput={onInput}
				/>
			)}
			<ul
				aria-label={`${action.label} conditions`}
				className={styles.conditions}
			>
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
				className={buttonClass(action)}
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
}

function CycleActionRail<A extends RailAction>({
	scope,
	actions,
	pending,
	unreadable,
	onRun,
	onInput,
}: {
	scope: string
	actions: A[]
	pending: boolean
	unreadable: boolean
	onRun: (action: A) => void
	onInput?: OnInput<A>
}) {
	const [open, setOpen] = useState<string | null | undefined>()
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
						{unreadable
							? `Could not read the ${scope} state.`
							: "No actions available."}
					</p>
				))}
			{actions.length > 0 && (
				<ul className={styles.list}>
					{actions.map((action) => {
						const state = readiness(action)
						const expanded = open === action.id
						const id = `${scope}-${action.id}-action`
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
									<ActionBody
										fieldId={`${scope}-${action.id}-field`}
										action={action}
										onRun={onRun}
										onInput={onInput}
									/>
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

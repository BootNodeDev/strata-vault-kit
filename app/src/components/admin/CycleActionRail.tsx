import React, { useState } from "react"
import {
	type ActionField as ActionFieldSpec,
	type Condition,
	type ConfirmField,
	type RailAction,
	type RailField,
	type Readiness,
	readiness,
	readyCount,
	type SelectField,
} from "../../pages/actions"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import styles from "./CycleActionRail.module.css"

type OnInput<A> = (action: A, value: string, key?: string) => void

const conditionValue = (condition: Condition): string => {
	if (condition.met === null) return "—"
	return condition.detail ?? (condition.met ? "Met" : "Not met")
}

const summaryOf = (state: Readiness): string => {
	if (state.kind === "ready") return "Ready"
	if (state.kind === "unavailable") return "Unavailable"
	if (state.kind === "unchanged") return "No change"
	return `${state.count} unmet`
}

type Report = (value: string) => void

const SelectInput: React.FC<{
	id: string
	field: SelectField
	report: Report
}> = ({ id, field, report }) => (
	<div className={styles.field}>
		<label htmlFor={id} className={styles.srOnly}>
			{field.label}
		</label>
		<select
			id={id}
			className={`${typeStyles.body} ${styles.fieldInput}`}
			value={field.value}
			onChange={(event) => report(event.target.value)}
		>
			{field.options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	</div>
)

const ConfirmInput: React.FC<{
	id: string
	field: ConfirmField
	report: Report
}> = ({ id, field, report }) => (
	<label htmlFor={id} className={styles.confirm}>
		<input
			id={id}
			type="checkbox"
			checked={field.checked}
			onChange={(event) => report(event.target.checked ? field.value : "")}
		/>
		<span className={typeStyles.footnote}>{field.label}</span>
	</label>
)

function RailInput<A extends RailAction<RailField>>({
	id,
	action,
	field,
	onInput,
}: {
	id: string
	action: A
	field: RailField
	onInput: OnInput<A> | undefined
}) {
	const report = (value: string) =>
		field.key === undefined
			? onInput?.(action, value)
			: onInput?.(action, value, field.key)
	switch (field.kind) {
		case "select":
			return <SelectInput id={id} field={field} report={report} />
		case "confirm":
			return <ConfirmInput id={id} field={field} report={report} />
		case undefined:
			return <TextInput id={id} field={field} report={report} />
	}
}

function TextInput({
	id,
	field,
	report,
}: {
	id: string
	field: ActionFieldSpec
	report: Report
}) {
	const label = (
		<label
			htmlFor={id}
			className={
				field.current === undefined
					? styles.srOnly
					: `${typeStyles.footnote} ${styles.fieldLabel}`
			}
		>
			{field.label}
		</label>
	)
	const input = (
		<div className={field.invalid ? styles.fieldOver : styles.field}>
			{field.current === undefined && label}
			<input
				id={id}
				className={`${typeStyles.amountInput} ${styles.fieldInput}`}
				value={field.value}
				onChange={(event) => report(event.target.value)}
				placeholder={field.placeholder}
				inputMode={field.text === true ? "text" : "decimal"}
			/>
			{field.max !== undefined && (
				<button
					type="button"
					className={styles.useMax}
					onClick={() => report(field.max ?? "")}
				>
					Use max
				</button>
			)}
		</div>
	)
	if (field.current === undefined) return input
	return (
		<div className={styles.keyed}>
			<div className={styles.keyedHead}>
				{label}
				<span className={`${typeStyles.footnote} ${styles.fieldValue}`}>
					Current {field.current}
				</span>
			</div>
			{input}
			{field.next !== undefined && field.next !== null && (
				<span className={`${typeStyles.footnote} ${styles.fieldValue}`}>
					New {field.next}
				</span>
			)}
		</div>
	)
}

const fieldsOf = (action: RailAction<RailField>): RailField[] =>
	action.fields ?? (action.field === undefined ? [] : [action.field])

const buttonClass = (action: RailAction<RailField>): string | undefined => {
	if (!action.enabled) return styles.actionUnavailable
	return action.tone === "danger" ? styles.actionDanger : styles.actionPrimary
}

function ActionBody<A extends RailAction<RailField>>({
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
			{fieldsOf(action).map((field) => (
				<RailInput
					key={field.key ?? field.label}
					id={field.key === undefined ? fieldId : `${fieldId}-${field.key}`}
					action={action}
					field={field}
					onInput={onInput}
				/>
			))}
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

function CycleActionRail<A extends RailAction<RailField>>({
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

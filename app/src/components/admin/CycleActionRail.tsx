import React, { useEffect, useRef, useState } from "react"
import { type Release } from "../../hooks/useContractTransaction"
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

const PREPARE_DELAY_MS = 400

const serialise = (value: unknown): string =>
	JSON.stringify(value, (_name, part: unknown) =>
		typeof part === "bigint" ? `${part}n` : part,
	)

type Status = "pass" | "fail" | "pending"

const statusOf = ({ met }: Condition): Status => {
	if (met === null) return "pending"
	return met ? "pass" : "fail"
}

const STATUS_PREFIX: Record<Status, string> = {
	pass: "Pass: ",
	fail: "Fail: ",
	pending: "Pending: ",
}

const STATUS_CLASS: Record<Status, string | undefined> = {
	pass: styles.pass,
	fail: styles.fail,
	pending: styles.pending,
}

const StatusIcon: React.FC<{ status: Status }> = ({ status }) =>
	status === "pending" ? (
		<span className={styles.dot} />
	) : (
		<svg viewBox="0 0 16 16" className={styles.icon}>
			<path d={status === "pass" ? "M3 8.5l3 3 7-7" : "M4 4l8 8M12 4l-8 8"} />
		</svg>
	)

const ConditionRow: React.FC<{ condition: Condition }> = ({ condition }) => {
	const status = statusOf(condition)
	return (
		<li className={styles.condition}>
			<span className={styles.check}>
				<span aria-hidden="true" className={STATUS_CLASS[status]}>
					<StatusIcon status={status} />
				</span>
				<span className={`${typeStyles.footnote} ${styles.conditionLabel}`}>
					<span className={styles.srOnly}>{STATUS_PREFIX[status]}</span>
					{condition.label}
				</span>
			</span>
			{condition.detail !== undefined && (
				<span className={`${typeStyles.railValue} ${styles.detail}`}>
					{condition.detail}
				</span>
			)}
		</li>
	)
}

const summaryOf = (state: Readiness): string => {
	if (state.kind === "ready") return "Ready"
	if (state.kind === "unavailable") return "Unavailable"
	if (state.kind === "unchanged") return "No change"
	return "Blocked"
}

type Report = (value: string) => void

const SelectInput: React.FC<{
	id: string
	field: SelectField
	report: Report
}> = ({ id, field, report }) => (
	<div className={styles.keyed}>
		<label
			htmlFor={id}
			className={`${typeStyles.footnote} ${styles.fieldLabel}`}
		>
			{field.label}
		</label>
		<div className={styles.field}>
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
					<ConditionRow key={condition.label} condition={condition} />
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

const slotOf = (action: RailAction<RailField> | undefined) =>
	action === undefined ? undefined : (action.slot ?? action.id)

function CycleActionRail<A extends RailAction<RailField>>({
	scope,
	actions,
	pending,
	unreadable,
	onRun,
	onReady,
	onInput,
}: {
	scope: string
	actions: A[]
	pending: boolean
	unreadable: boolean
	onRun: (action: A) => void
	onReady?: (action: A) => Release | undefined
	onInput?: OnInput<A>
}) {
	const [open, setOpen] = useState<string | null | undefined>()
	if (open === undefined && actions.length > 0)
		setOpen(slotOf(actions.find((action) => action.enabled)) ?? null)
	const ready = actions.find(
		(action) => slotOf(action) === open && action.enabled,
	)

	const latest = useRef({ ready, onReady })
	useEffect(() => {
		latest.current = { ready, onReady }
	})
	const readyKey = ready === undefined ? null : serialise(ready)
	const reportable = onReady !== undefined

	useEffect(() => {
		if (readyKey === null || !reportable) return
		let release: Release | undefined
		const timer = setTimeout(() => {
			const { ready: action, onReady: report } = latest.current
			if (action !== undefined) release = report?.(action)
		}, PREPARE_DELAY_MS)
		return () => {
			clearTimeout(timer)
			release?.()
		}
	}, [readyKey, reportable])

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
						const slot = slotOf(action)
						const expanded = open === slot
						const id = `${scope}-${slot}-action`
						return (
							<li className={styles.item} key={slot}>
								<button
									type="button"
									className={styles.toggle}
									aria-expanded={expanded}
									aria-controls={id}
									aria-labelledby={`${id}-label`}
									aria-describedby={`${id}-summary`}
									onClick={() => setOpen(expanded ? null : slot)}
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
										fieldId={`${scope}-${slot}-field`}
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

import React from "react"
import {
	type ActionField as ActionFieldSpec,
	type Condition,
	type CycleAction,
} from "../../pages/cycle"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import { type AddressRow, type FigureGroup } from "../vault/AboutVault"
import AddressRows from "../vault/AddressRows"
import MetricsStrip, { type Metric } from "../vault/MetricsStrip"
import styles from "./CycleSurface.module.css"

export type CycleGroup = FigureGroup & {
	tiles: Metric[]
	addresses?: AddressRow[]
	actions?: React.ReactNode
}

export type EpochRow = {
	id: string
	status: string
	deposited: string
	redeeming: string
	price: string
}

export type ActivityDetail = (string | { figure: string })[]

export type ActivityRow = {
	key: string
	title: string
	detail: ActivityDetail
	when: string
}

export type ListState<T> =
	| { status: "checking" }
	| { status: "unreadable" }
	| { status: "loaded"; rows: T[]; note?: string | undefined }

type CycleSurfaceProps = {
	groups: CycleGroup[]
	unreadable: boolean
	epochs: ListState<EpochRow>
	activity: ListState<ActivityRow>
}

const EPOCH_COLUMNS = [
	"Epoch",
	"Status",
	"Deposited",
	"Shares redeeming",
	"Share price",
]

const ACTIVITY_COLUMNS = ["Time", "Event", "Detail"]

const figureCell = `${typeStyles.railValue} ${styles.cell}`

const Group: React.FC<{ group: CycleGroup }> = ({ group }) => (
	<div className={styles.group}>
		<h3 className={`${typeStyles.body} ${styles.groupTitle}`}>{group.title}</h3>
		<MetricsStrip metrics={group.tiles} />
		<ul className={styles.rows}>
			{group.rows.map((row) => (
				<li className={styles.row} key={row.label}>
					<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
						{row.label}
					</span>
					{row.pending ? (
						<Skeleton
							className={`${typeStyles.railValue} ${styles.rowSkeleton}`}
						/>
					) : (
						<span
							className={`${typeStyles.railValue} ${
								row.value === null ? styles.placeholder : styles.rowValue
							}`}
						>
							{row.value ?? "Unavailable"}
						</span>
					)}
				</li>
			))}
		</ul>
		{group.addresses !== undefined && <AddressRows rows={group.addresses} />}
		{group.actions}
	</div>
)

const conditionValue = (condition: Condition): string => {
	if (condition.met === null) return "—"
	return condition.detail ?? (condition.met ? "Met" : "Not met")
}

const ActionField: React.FC<{
	action: CycleAction
	field: ActionFieldSpec
	onInput: ((action: CycleAction, value: string) => void) | undefined
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

export const CycleActions: React.FC<{
	actions: CycleAction[]
	onRun: (action: CycleAction) => void
	onInput?: (action: CycleAction, value: string) => void
}> = ({ actions, onRun, onInput }) => (
	<div className={styles.actionArea}>
		{actions.map((action) => (
			<div className={styles.action} key={action.id}>
				{action.field !== undefined && (
					<ActionField action={action} field={action.field} onInput={onInput} />
				)}
				<ul
					aria-label={`${action.label} conditions`}
					className={styles.conditions}
				>
					{action.conditions.map((condition) => (
						<li className={styles.row} key={condition.label}>
							<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
								{condition.label}
							</span>
							<span
								className={`${typeStyles.railValue} ${
									condition.met ? styles.rowValue : styles.unmet
								}`}
							>
								{conditionValue(condition)}
							</span>
						</li>
					))}
				</ul>
				{action.note !== undefined && (
					<p className={`${typeStyles.footnote} ${styles.note}`}>
						{action.note}
					</p>
				)}
				{action.outcome !== null && (
					<p className={`${typeStyles.footnote} ${styles.outcome}`}>
						{action.outcome}
					</p>
				)}
				<div className={styles.actions}>
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
				</div>
				{action.unavailable !== undefined && (
					<p className={`${typeStyles.footnote} ${styles.placeholder}`}>
						{action.unavailable}
					</p>
				)}
			</div>
		))}
	</div>
)

const Section: React.FC<{
	title: string
	state: ListState<unknown>
	unreadable: string
	empty: string
	children: React.ReactNode
}> = ({ title, state, unreadable, empty, children }) => (
	<div className={styles.group}>
		<h3 className={`${typeStyles.body} ${styles.groupTitle}`}>{title}</h3>
		{state.status === "checking" && (
			<Skeleton className={styles.sectionSkeleton} />
		)}
		{state.status === "unreadable" && (
			<p className={`${typeStyles.footnote} ${styles.placeholder}`}>
				{unreadable}
			</p>
		)}
		{state.status === "loaded" && state.rows.length === 0 && (
			<p className={`${typeStyles.footnote} ${styles.placeholder}`}>{empty}</p>
		)}
		{state.status === "loaded" && state.rows.length > 0 && children}
		{state.status === "loaded" && state.note !== undefined && (
			<p className={`${typeStyles.footnote} ${styles.placeholder}`}>
				{state.note}
			</p>
		)}
	</div>
)

const Table: React.FC<{
	name: string
	columns: string[]
	children: React.ReactNode
}> = ({ name, columns, children }) => (
	<div className={styles.tableScroll}>
		<table aria-label={name} className={styles.table}>
			<thead>
				<tr>
					{columns.map((column) => (
						<th
							className={`${typeStyles.label} ${styles.headCell}`}
							key={column}
							scope="col"
						>
							{column}
						</th>
					))}
				</tr>
			</thead>
			<tbody>{children}</tbody>
		</table>
	</div>
)

const EpochTable: React.FC<{ rows: EpochRow[] }> = ({ rows }) => (
	<Table name="Epochs" columns={EPOCH_COLUMNS}>
		{rows.map((row) => (
			<tr key={row.id}>
				<td className={figureCell}>{row.id}</td>
				<td className={figureCell}>{row.status}</td>
				<td className={figureCell}>{row.deposited}</td>
				<td className={figureCell}>{row.redeeming}</td>
				<td className={figureCell}>{row.price}</td>
			</tr>
		))}
	</Table>
)

const Detail: React.FC<{ parts: ActivityDetail }> = ({ parts }) => (
	<>
		{parts.map((part, index) =>
			typeof part === "string" ? (
				part
			) : (
				<span className={typeStyles.railValue} key={index}>
					{part.figure}
				</span>
			),
		)}
	</>
)

const ActivityTable: React.FC<{ rows: ActivityRow[] }> = ({ rows }) => (
	<Table name="Recent activity" columns={ACTIVITY_COLUMNS}>
		{rows.map((row) => (
			<tr key={row.key}>
				<td className={figureCell}>{row.when}</td>
				<td className={`${typeStyles.footnote} ${styles.cell}`}>{row.title}</td>
				<td
					className={`${typeStyles.footnote} ${styles.cell} ${styles.detailCell}`}
				>
					<Detail parts={row.detail} />
				</td>
			</tr>
		))}
	</Table>
)

const CycleSurface: React.FC<CycleSurfaceProps> = ({
	groups,
	unreadable,
	epochs,
	activity,
}) => (
	<div className={styles.surface}>
		{unreadable ? (
			<p className={typeStyles.body}>Could not read the vault's cycle.</p>
		) : (
			groups.map((group) => <Group group={group} key={group.title} />)
		)}
		<Section
			title="Epochs"
			state={epochs}
			unreadable="Could not read the epoch history."
			empty="No epochs yet."
		>
			{epochs.status === "loaded" && <EpochTable rows={epochs.rows} />}
		</Section>
		<Section
			title="Recent activity — last 7 days"
			state={activity}
			unreadable="Could not read recent activity."
			empty="No cycle activity in the last 7 days."
		>
			{activity.status === "loaded" && <ActivityTable rows={activity.rows} />}
		</Section>
	</div>
)

export default CycleSurface

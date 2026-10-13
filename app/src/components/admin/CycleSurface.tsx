import React from "react"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import { type AddressRow, type FigureGroup } from "../vault/AboutVault"
import AddressRows from "../vault/AddressRows"
import MetricsStrip, { type Metric } from "../vault/MetricsStrip"
import styles from "./CycleSurface.module.css"

export type CycleGroup = FigureGroup & {
	tiles: Metric[]
	addresses?: AddressRow[]
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

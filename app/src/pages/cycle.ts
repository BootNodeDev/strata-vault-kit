import {
	AMOUNT_DECIMALS,
	type Amount,
	type ChainEvent,
	formatDayMonth,
	formatScaled,
	PRICE_DECIMALS,
	type Price,
	shortAddress,
} from "@stellar-scaffold/app-lib"
import {
	type ActivityDetail,
	type ActivityRow,
	type CycleGroup,
	type EpochRow,
	type ListState,
} from "../components/admin/CycleSurface"
import { type FigureRow } from "../components/vault/AboutVault"
import { type Metric } from "../components/vault/MetricsStrip"
import { type Grant, type Standing } from "../hooks/useAdminAuthority"
import {
	type CycleEventsRead,
	type CycleOracle,
	type CycleState,
	type CycleWindDown,
	type DepositCap,
	type WindDownPhase,
} from "../hooks/useCycleState"
import {
	type EpochHistoryRead,
	type EpochRecord,
} from "../hooks/useEpochHistory"

type ReadyState = Extract<CycleState, { status: "ready" }>

const ACTIVITY_LIMIT = 10
const NOT_APPLICABLE = "—"

const GROUP_LAYOUT: { title: string; tiles: string[]; rows: string[] }[] = [
	{
		title: "Epoch",
		tiles: [
			"Open epoch",
			"Awaiting price",
			"Deposits requested",
			"Redemptions requested",
		],
		rows: ["Vault", "Notice period", "Sealed at", "Notice"],
	},
	{
		title: "Price",
		tiles: ["Share price", "Attested", "Valid until"],
		rows: [
			"Ripcord",
			"Freshness window",
			"Cooldown",
			"Largest rise",
			"Largest fall",
			"Price floor",
			"Price ceiling",
		],
	},
	{
		title: "Reserve",
		tiles: ["Free", "Uncovered", "Net deployed", "Custodian balance"],
		rows: ["Committed", "Liquid reserve", "Deposit cap"],
	},
	{
		title: "Wind-down",
		tiles: ["Status", "Round", "Owed"],
		rows: ["Activates at", "Delay", "Supply"],
	},
]

const EPOCH_STATUS_LABELS: Record<EpochRecord["status"], string> = {
	Open: "Open",
	Pending: "Sealed",
	Fulfilled: "Priced",
}

const PRICE_STATUS_LABELS: Record<CycleOracle["state"], string | undefined> = {
	valid: "Valid",
	stale: "Stale",
	paused: "Paused",
	never: "None attested",
	unreadable: undefined,
}

const WIND_DOWN_LABELS = {
	none: "None",
	proposed: "Proposed",
	active: "Active",
} as const

const SECONDS_PER_UNIT: [string, bigint][] = [
	["d", 86_400n],
	["h", 3_600n],
	["m", 60n],
	["s", 1n],
]

export function formatDuration(seconds: bigint): string {
	const parts: string[] = []
	let remaining = seconds
	for (const [unit, size] of SECONDS_PER_UNIT) {
		const count = remaining / size
		remaining -= count * size
		if (count > 0n && parts.length < 2) parts.push(`${count}${unit}`)
	}
	return parts.length === 0 ? "0s" : parts.join(" ")
}

const formatClock = (seconds: bigint): string =>
	new Intl.DateTimeFormat("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: "UTC",
	}).format(new Date(Number(seconds) * 1000))

export function formatTimestamp(seconds: bigint): string {
	const date = formatDayMonth(seconds)
	return date === NOT_APPLICABLE
		? NOT_APPLICABLE
		: `${date}, ${formatClock(seconds)} UTC`
}

const formatAmountValue = (raw: Amount | null): string | null =>
	raw === null ? null : formatScaled(raw, AMOUNT_DECIMALS)

const formatPriceValue = (raw: bigint | null): string | null =>
	raw === null ? null : formatScaled(raw as Price, PRICE_DECIMALS, 4)

const formatPercent = (basisPoints: number): string => `${basisPoints / 100}%`

const orNotApplicable = <T>(
	value: T | null,
	format: (value: T) => string | null,
): string | null => (value === null ? NOT_APPLICABLE : format(value))

const row = (label: string, value: string | null): FigureRow => ({
	label,
	value,
})

const tile = (label: string, value: string | null, note?: string): Metric =>
	note === undefined ? { label, value } : { label, value, note }

function epochGroup(state: ReadyState): CycleGroup {
	const { epoch, ledgerTime, paused } = state
	const { awaiting } = epoch
	const noticeState = (record: EpochRecord): string | null => {
		if (ledgerTime === null) return null
		return ledgerTime >= record.priceableAt
			? "Elapsed"
			: `Elapses ${formatTimestamp(record.priceableAt)}`
	}

	return {
		title: "Epoch",
		tiles: [
			tile("Open epoch", String(epoch.id)),
			tile(
				"Awaiting price",
				!epoch.awaitingKnown
					? null
					: awaiting === null
						? "None"
						: String(awaiting.id),
			),
			tile(
				"Deposits requested",
				formatAmountValue(epoch.open?.totalDeposited ?? null),
			),
			tile(
				"Redemptions requested",
				formatAmountValue(epoch.open?.totalSharesRedeeming ?? null),
			),
		],
		rows: [
			row(
				"Vault",
				paused === "unreadable" || paused === "checking"
					? null
					: paused === "paused"
						? "Paused"
						: "Accepting requests",
			),
			row(
				"Notice period",
				epoch.noticeSeconds === null
					? null
					: formatDuration(epoch.noticeSeconds),
			),
			row(
				"Sealed at",
				!epoch.awaitingKnown
					? null
					: orNotApplicable(awaiting, (record) =>
							formatTimestamp(record.closedAt),
						),
			),
			row(
				"Notice",
				!epoch.awaitingKnown ? null : orNotApplicable(awaiting, noticeState),
			),
		],
	}
}

function priceGroup(oracle: CycleOracle): CycleGroup {
	const { limits } = oracle
	const timestamp = (value: bigint | null): string | null =>
		oracle.state === "unreadable"
			? null
			: orNotApplicable(value, formatTimestamp)

	return {
		title: "Price",
		tiles: [
			tile(
				"Share price",
				oracle.state === "never" ? null : formatPriceValue(oracle.price),
				PRICE_STATUS_LABELS[oracle.state],
			),
			tile("Attested", timestamp(oracle.attestedAt)),
			tile("Valid until", timestamp(oracle.expiresAt)),
		],
		rows: [
			row(
				"Ripcord",
				oracle.ripcord === null
					? null
					: oracle.ripcord
						? "Raised"
						: "Not raised",
			),
			row("Freshness window", limits && formatDuration(limits.freshness)),
			row("Cooldown", limits && formatDuration(limits.cooldown)),
			row("Largest rise", limits && formatPercent(limits.maxUpBps)),
			row(
				"Largest fall",
				limits &&
					(limits.maxDownBps === null
						? "No limit"
						: formatPercent(limits.maxDownBps)),
			),
			row("Price floor", limits && formatPriceValue(limits.min)),
			row("Price ceiling", limits && formatPriceValue(limits.max)),
		],
	}
}

const coverage = (uncovered: Amount | null): string | undefined => {
	if (uncovered === null) return undefined
	return uncovered > 0n
		? `${formatScaled(uncovered, AMOUNT_DECIMALS)} short`
		: "Covered"
}

const depositCapValue = (cap: DepositCap | null): string | null => {
	if (cap === null) return null
	return cap.kind === "uncapped"
		? "No cap"
		: formatScaled(cap.amount, AMOUNT_DECIMALS)
}

function reserveGroup(state: ReadyState): CycleGroup {
	const { reserve } = state
	return {
		title: "Reserve",
		tiles: [
			tile("Free", formatAmountValue(reserve.free)),
			tile(
				"Uncovered",
				formatAmountValue(reserve.uncovered),
				coverage(reserve.uncovered),
			),
			tile("Net deployed", formatAmountValue(reserve.netDeployed)),
			tile("Custodian balance", formatAmountValue(reserve.custodianBalance)),
		],
		rows: [
			row("Committed", formatAmountValue(reserve.committed)),
			row("Liquid reserve", formatAmountValue(reserve.liquid)),
			row("Deposit cap", depositCapValue(reserve.depositCap)),
		],
		addresses: [{ label: "Custodian", address: reserve.custodian }],
	}
}

const unlessNone = (
	phase: WindDownPhase | null,
	value: () => string | null,
): string | null => {
	if (phase === null) return null
	return phase === "none" ? NOT_APPLICABLE : value()
}

function windDownGroup(windDown: CycleWindDown): CycleGroup {
	const { phase } = windDown
	return {
		title: "Wind-down",
		tiles: [
			tile("Status", phase === null ? null : WIND_DOWN_LABELS[phase]),
			tile(
				"Round",
				unlessNone(phase, () =>
					windDown.round === null ? null : String(windDown.round),
				),
			),
			tile("Owed", formatAmountValue(windDown.owed)),
		],
		rows: [
			row(
				"Activates at",
				unlessNone(phase, () =>
					orNotApplicable(windDown.activeAt, formatTimestamp),
				),
			),
			row(
				"Delay",
				windDown.delay === null ? null : formatDuration(windDown.delay),
			),
			row("Supply", formatAmountValue(windDown.supply)),
		],
	}
}

export type CycleActionId = "close-epoch" | "fulfill-epoch"

export type Condition = { label: string; met: boolean }

export type CycleAction = {
	id: CycleActionId
	label: string
	conditions: Condition[]
	outcome: string | null
	epochId: bigint | null
	enabled: boolean
	unavailable?: string
}

const MANAGER_ROLE = "vault manager"

const signaturesNeeded = (standing: Standing): number | null => {
	if (standing === "signs-alone") return null
	return "needs" in standing ? standing.needs : standing.threshold
}

export const grantFor = (
	grants: Grant[],
	role: string,
	wallet: string,
): Grant | undefined => {
	const ofRole = grants.filter((grant) => grant.role === role)
	return ofRole.find((grant) => grant.authority === wallet) ?? ofRole[0]
}

export const unavailableFor = (
	grant: Grant,
	wallet: string,
): string | undefined => {
	const needed = signaturesNeeded(grant.standing)
	if (needed !== null)
		return `Needs ${needed} signatures; collecting them is not supported yet.`
	if (grant.authority !== wallet)
		return `Signs for ${shortAddress(grant.authority)}; acting on its behalf is not supported yet.`
	return undefined
}

const windDownInactive = (state: ReadyState): Condition => ({
	label: "Wind-down not active",
	met: state.windDown.phase !== null && state.windDown.phase !== "active",
})

const toAction = (
	id: CycleActionId,
	label: string,
	conditions: Condition[],
	outcome: string | null,
	epochId: bigint | null,
	unavailable?: string,
): CycleAction => ({
	id,
	label,
	conditions,
	outcome,
	epochId,
	enabled:
		unavailable === undefined &&
		epochId !== null &&
		conditions.every((condition) => condition.met),
	...(unavailable === undefined ? {} : { unavailable }),
})

function toCloseAction(
	state: ReadyState,
	grant: Grant,
	wallet: string,
): CycleAction {
	const { epoch } = state
	return toAction(
		"close-epoch",
		"Close epoch",
		[
			windDownInactive(state),
			{ label: "Epoch open", met: epoch.open?.status === "Open" },
		],
		`Seals epoch ${epoch.id} and opens epoch ${epoch.id + 1n}.`,
		epoch.id,
		unavailableFor(grant, wallet),
	)
}

function toFulfillAction(state: ReadyState): CycleAction {
	const { awaiting } = state.epoch
	const { oracle, ledgerTime } = state
	const price = formatPriceValue(oracle.price)
	return toAction(
		"fulfill-epoch",
		"Fulfill epoch",
		[
			{ label: "Sealed epoch awaiting a price", met: awaiting !== null },
			{
				label: "Notice elapsed",
				met:
					awaiting !== null &&
					ledgerTime !== null &&
					ledgerTime >= awaiting.priceableAt,
			},
			{ label: "Price valid", met: oracle.state === "valid" },
			{
				label: "Attested after the close",
				met:
					awaiting !== null &&
					oracle.attestedAt !== null &&
					oracle.attestedAt >= awaiting.closedAt,
			},
			{ label: "Vault not paused", met: state.paused === "open" },
			windDownInactive(state),
		],
		awaiting === null || price === null
			? null
			: `Prices epoch ${awaiting.id} at ${price} and settles its requests.`,
		awaiting?.id ?? null,
	)
}

export function toCycleActions(
	state: CycleState,
	grants: Grant[],
	wallet: string,
): CycleAction[] {
	if (state.status !== "ready" || grants.length === 0) return []
	const manager = grantFor(grants, MANAGER_ROLE, wallet)
	const actions: CycleAction[] = []
	if (manager !== undefined) actions.push(toCloseAction(state, manager, wallet))
	actions.push(toFulfillAction(state))
	return actions
}

export function toCycleRows(state: CycleState): CycleGroup[] {
	if (state.status === "unreadable") return []
	if (state.status === "checking") {
		return GROUP_LAYOUT.map(({ title, tiles, rows }) => ({
			title,
			tiles: tiles.map((label) => ({ label, value: null, pending: true })),
			rows: rows.map((label) => ({ label, value: null, pending: true })),
		}))
	}

	return [
		epochGroup(state),
		priceGroup(state.oracle),
		reserveGroup(state),
		windDownGroup(state.windDown),
	]
}

const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`

const historyNote = (
	absent: number,
	unreadable: number,
): string | undefined => {
	const notes: string[] = []
	if (absent > 0) notes.push(`${plural(absent, "earlier epoch")} archived`)
	if (unreadable > 0)
		notes.push(`${plural(unreadable, "epoch")} could not be read`)
	return notes.length === 0 ? undefined : `${notes.join(" · ")}.`
}

export function toEpochList(history: EpochHistoryRead): ListState<EpochRow> {
	if (history.status !== "loaded") return { status: history.status }
	return {
		status: "loaded",
		rows: history.epochs.map((epoch) => ({
			id: String(epoch.id),
			status: EPOCH_STATUS_LABELS[epoch.status],
			deposited: formatScaled(epoch.totalDeposited, AMOUNT_DECIMALS),
			redeeming: formatScaled(epoch.totalSharesRedeeming, AMOUNT_DECIMALS),
			price:
				epoch.sharePrice === null
					? NOT_APPLICABLE
					: formatScaled(epoch.sharePrice, PRICE_DECIMALS, 4),
		})),
		note: historyNote(history.absent.length, history.unreadable.length),
	}
}

type Described = { title: string; detail: ActivityDetail }

const figure = (text: string): { figure: string } => ({ figure: text })

const field = (data: unknown, key: string): bigint | null => {
	if (typeof data !== "object" || data === null) return null
	const value = (data as Record<string, unknown>)[key]
	return typeof value === "bigint" ? value : null
}

const topicAt = (event: ChainEvent, index: number): unknown =>
	event.topics[index]

const amountText = (raw: bigint): string =>
	formatScaled(raw as Amount, AMOUNT_DECIMALS)

const priceText = (raw: bigint): string =>
	formatScaled(raw as Price, PRICE_DECIMALS, 4)

function describeEpochClosed(event: ChainEvent): Described | null {
	const epoch = topicAt(event, 0)
	const deposited = field(event.data, "total_deposited")
	const redeeming = field(event.data, "total_shares_redeeming")
	if (typeof epoch !== "bigint" || deposited === null || redeeming === null)
		return null
	return {
		title: `Epoch ${epoch} sealed`,
		detail: [
			figure(amountText(deposited)),
			" deposited · ",
			figure(amountText(redeeming)),
			" shares redeeming",
		],
	}
}

function describeEpochFulfilled(event: ChainEvent): Described | null {
	const epoch = topicAt(event, 0)
	const sharePrice = field(event.data, "share_price")
	if (typeof epoch !== "bigint" || sharePrice === null) return null
	return {
		title: `Epoch ${epoch} priced`,
		detail: ["Share price ", figure(priceText(sharePrice))],
	}
}

function describeNavAttested(event: ChainEvent): Described | null {
	const attester = topicAt(event, 0)
	const navPerShare = field(event.data, "nav_per_share")
	if (typeof attester !== "string" || navPerShare === null) return null
	return {
		title: "Price attested",
		detail: [
			figure(priceText(navPerShare)),
			" · ",
			figure(shortAddress(attester)),
		],
	}
}

function describeDepositRequested(event: ChainEvent): Described | null {
	const controller = topicAt(event, 0)
	const epoch = field(event.data, "epoch")
	const amount = field(event.data, "amount")
	if (typeof controller !== "string" || epoch === null || amount === null)
		return null
	return {
		title: "Deposit requested",
		detail: [
			figure(amountText(amount)),
			` in epoch ${epoch} · `,
			figure(shortAddress(controller)),
		],
	}
}

function describeDepositClaimed(event: ChainEvent): Described | null {
	const controller = topicAt(event, 0)
	const epoch = field(event.data, "epoch")
	const amount = field(event.data, "amount")
	if (typeof controller !== "string" || epoch === null || amount === null)
		return null
	return {
		title: "Deposit claimed",
		detail: [
			figure(amountText(amount)),
			` from epoch ${epoch} · `,
			figure(shortAddress(controller)),
		],
	}
}

const DESCRIBERS: Record<string, (event: ChainEvent) => Described | null> = {
	epoch_closed: describeEpochClosed,
	epoch_fulfilled: describeEpochFulfilled,
	nav_attested: describeNavAttested,
	deposit_requested: describeDepositRequested,
	deposit_claimed: describeDepositClaimed,
}

const PARTIAL_ACTIVITY_NOTE = "Only part of the last 7 days is shown."

function toActivity(events: ChainEvent[]): ActivityRow[] {
	const newestFirst = events
		.map((event, index) => ({ event, index }))
		.sort((a, b) => b.event.ledger - a.event.ledger || b.index - a.index)

	const rows: ActivityRow[] = []
	for (const { event, index } of newestFirst) {
		const described = DESCRIBERS[event.name]?.(event) ?? null
		if (described === null) continue
		rows.push({
			key: `${event.ledger}-${index}`,
			...described,
			when: formatTimestamp(event.closedAt),
		})
		if (rows.length === ACTIVITY_LIMIT) break
	}
	return rows
}

export function toActivityList(
	cycleEvents: CycleEventsRead,
): ListState<ActivityRow> {
	if (cycleEvents.status !== "loaded") return { status: cycleEvents.status }
	return {
		status: "loaded",
		rows: toActivity(cycleEvents.events),
		note: cycleEvents.partial ? PARTIAL_ACTIVITY_NOTE : undefined,
	}
}

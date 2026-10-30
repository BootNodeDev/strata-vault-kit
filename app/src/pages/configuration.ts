import { StrKey } from "@stellar/stellar-sdk"
import {
	AMOUNT_DECIMALS,
	type Amount,
	formatExact,
	formatScaled,
	parseUnits,
	PRICE_DECIMALS,
	type Price,
	shortAddress,
} from "@stellar-scaffold/app-lib"
import { type AddressRow } from "../components/vault/AddressRows"
import { type Metric } from "../components/vault/MetricsStrip"
import { type Grant } from "../hooks/useAdminAuthority"
import {
	type ConfigurationState,
	type ConfigurationValues,
} from "../hooks/useConfigurationState"
import { type OracleConfig } from "../hooks/useConfigurationTransactions"
import { type OracleLimits } from "../hooks/useCycleState"
import {
	type ActionField,
	allMet,
	type Condition,
	grantFor,
	type RailAction,
	ROLES,
	type Spec,
	toAction,
} from "./actions"
import {
	DAY,
	depositCapValue,
	exactAmount,
	formatDuration,
	formatPercent,
	oracleLimitRows,
	parseDuration,
} from "./cycle"
import { type Route, routeCondition, routeOf } from "./timelock"
import { toCustodianRow } from "./vaultMetrics"

export type FieldKey =
	| "depositCap"
	| "custodian"
	| "notice"
	| "windDownDelay"
	| "minEpochDuration"
	| "freshness"
	| "cooldown"
	| "maxRise"
	| "maxFall"
	| "floor"
	| "ceiling"
	| "compliance"
	| "identityVerifier"

export type ConfigurationInputs = Partial<Record<FieldKey, string>>

type Setter<Id extends string, Arg> = Id extends string
	? RailAction & { id: Id; arg: Arg | undefined; next: string }
	: never

export type ConfigurationAction =
	| Setter<"set-deposit-cap", bigint | null>
	| Setter<
			| "set-custodian"
			| "propose-custodian"
			| "set-compliance"
			| "propose-compliance"
			| "set-identity-verifier"
			| "propose-identity-verifier",
			string
	  >
	| Setter<
			| "set-notice"
			| "propose-notice"
			| "set-wind-down-delay"
			| "propose-wind-down-delay"
			| "set-min-epoch-duration"
			| "propose-min-epoch-duration",
			bigint
	  >
	| Setter<"set-oracle-config" | "propose-oracle-config", OracleConfig>

export type ConfigurationGroup = {
	title: string
	strips: Metric[][]
	addresses: AddressRow[]
}

export const EFFECTS = {
	custodian: "Treasury deploys to the new address from now on.",
	notice: "Applies to epochs closed from now on.",
	windDownDelay: "A proposed wind-down keeps its activation time.",
	minEpochDuration: "Anyone may seal an epoch once it has been open this long.",
} as const

const MAX_NOTICE = 30n * DAY
const MIN_WIND_DOWN_DELAY = 7n * DAY
const MAX_WIND_DOWN_DELAY = 90n * DAY
const MIN_EPOCH_DURATION = DAY
const MAX_EPOCH_DURATION = 30n * DAY
const MIN_SECS = 1n
const MAX_FRESHNESS = 35n * DAY
const MIN_BPS = 1
const MAX_BPS = 10_000
const MAX_I128 = (1n << 127n) - 1n
const MAX_CEILING = 1_000_000n * 10n ** BigInt(PRICE_DECIMALS)
const PERCENT = /^(\d+)(?:\.(\d{1,2}))?\s*%?$/

type Kind<T> = {
	parse: (text: string) => T | undefined
	show: (value: T) => string
	prefill?: (value: T) => string
	placeholder: string
	text?: boolean
}

const parseBps = (text: string): number | undefined => {
	const match = PERCENT.exec(text.trim())
	if (match === null) return undefined
	const [, whole = "", fraction = ""] = match
	return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
}

const orNone =
	<T>(parse: (text: string) => T | undefined) =>
	(text: string): T | null | undefined =>
		text.trim() === "" ? null : parse(text)

const DURATION: Kind<bigint> = {
	parse: (text) => parseDuration(text) ?? undefined,
	show: (seconds) => formatDuration(seconds, 4),
	placeholder: "7d",
	text: true,
}

const address = (accepts: (text: string) => boolean): Kind<string> => ({
	parse: (text) => (accepts(text.trim()) ? text.trim() : undefined),
	show: shortAddress,
	prefill: (value) => value,
	placeholder: "Address",
	text: true,
})

const ANY_ADDRESS = address(
	(text) =>
		StrKey.isValidEd25519PublicKey(text) || StrKey.isValidContract(text),
)
const CONTRACT = address((text) => StrKey.isValidContract(text))

const CAP: Kind<Amount | null> = {
	parse: orNone((text) => parseUnits(text, AMOUNT_DECIMALS) ?? undefined),
	show: (cap) => (cap === null ? "No cap" : exactAmount(cap)),
	prefill: (cap) => (cap === null ? "" : exactAmount(cap)),
	placeholder: "No cap",
}

const PRICE: Kind<bigint> = {
	parse: (text) => parseUnits(text, PRICE_DECIMALS) ?? undefined,
	show: (price) => formatExact(price as Price, PRICE_DECIMALS),
	placeholder: "0.00",
}

const MOVE: Kind<number> = {
	parse: parseBps,
	show: formatPercent,
	prefill: (bps) => String(bps / 100),
	placeholder: "10",
}

type Parsed<T> = { arg: T | undefined; field: ActionField }

function parsed<T>(
	key: FieldKey,
	label: string,
	kind: Kind<T>,
	current: T | undefined,
	inputs: ConfigurationInputs,
): Parsed<T> {
	const prefill = kind.prefill ?? kind.show
	const input = inputs[key] ?? (current === undefined ? "" : prefill(current))
	const arg = kind.parse(input)
	return {
		arg,
		field: {
			key,
			label,
			placeholder: kind.placeholder,
			value: input,
			invalid: input.trim() !== "" && arg === undefined,
			...(kind.text === true ? { text: true } : {}),
			current: current === undefined ? "—" : kind.show(current),
			next: arg === undefined ? null : kind.show(arg),
		},
	}
}

const known = <T>(value: T | null): T | undefined => value ?? undefined

const UNSET = Symbol("unset")

type Current<T> = T | typeof UNSET | undefined

const bound = <T>(
	label: string,
	value: T | undefined,
	holds: (value: T) => boolean,
): Condition => ({ label, met: value === undefined ? null : holds(value) })

const differs = (changed: boolean | undefined): Condition => ({
	label: "Differs from current",
	met: changed ?? null,
	unchanged: true,
})

const changedFrom = <T>(arg: T | undefined, current: Current<T>) =>
	arg === undefined || current === undefined ? undefined : arg !== current

function single<Id extends ConfigurationAction["id"], T>(
	id: Id,
	label: string,
	field: Parsed<T>,
	current: Current<T>,
	bounds: Condition[],
	outcome: string | null = null,
): Spec<Id> & { arg: T | undefined; next: string } {
	const conditions = [...bounds, differs(changedFrom(field.arg, current))]
	return {
		id,
		label,
		conditions,
		outcome,
		fields: [field.field],
		ready: allMet(conditions),
		arg: field.arg,
		next: field.field.next ?? "",
	}
}

const capOf = (state: ConfigurationValues): Amount | null | undefined => {
	if (state.depositCap === null) return undefined
	return state.depositCap.kind === "uncapped" ? null : state.depositCap.amount
}

const upgradeBound = (
	notice: bigint | undefined,
	upgradeDelay: bigint | null,
): Condition => ({
	label:
		upgradeDelay === null
			? "Notice ≤ upgrade delay"
			: `Notice ≤ upgrade delay ${formatDuration(upgradeDelay)}`,
	met:
		notice === undefined || upgradeDelay === null
			? null
			: notice <= upgradeDelay,
})

const lowering = (
	arg: bigint | undefined,
	current: bigint | undefined,
): boolean | undefined =>
	arg === undefined || current === undefined ? undefined : arg < current

const RAISED = "Raising is instant"

function vaultSpecs(state: ConfigurationValues, inputs: ConfigurationInputs) {
	const cap = capOf(state)
	const capField = parsed("depositCap", "Deposit cap", CAP, cap, inputs)
	const custodian =
		state.custodian.kind === "set" ? state.custodian.address : undefined
	const notice = known(state.notice)
	const noticeField = parsed("notice", "Notice", DURATION, notice, inputs)
	const delay = known(state.windDownDelay)
	const delayField = parsed(
		"windDownDelay",
		"Wind-down delay",
		DURATION,
		delay,
		inputs,
	)
	const minEpoch = state.minEpochDuration
	const minEpochSecs = minEpoch?.kind === "set" ? minEpoch.secs : undefined
	const minEpochField = parsed(
		"minEpochDuration",
		"Minimum epoch duration",
		DURATION,
		minEpochSecs,
		inputs,
	)
	const setupRoute = routeOf(state.setupOpen, true)
	const noticeRoute = routeOf(
		state.setupOpen,
		lowering(noticeField.arg, notice),
	)
	const delayRoute = routeOf(state.setupOpen, lowering(delayField.arg, delay))
	const waits = (route: Route) =>
		routeCondition(
			route,
			state.upgradeDelay,
			state.setupOpen === true ? undefined : RAISED,
		)
	return [
		single("set-deposit-cap", "Set the deposit cap", capField, cap, [
			bound("Deposit cap ≥ 0", capField.arg, (value) => (value ?? 0n) >= 0n),
			bound(
				"Deposit cap ≤ 2^127−1",
				capField.arg,
				(value) => (value ?? 0n) <= MAX_I128,
			),
		]),
		{
			...single(
				setupRoute === "timelock" ? "propose-custodian" : "set-custodian",
				"Set the custodian",
				parsed("custodian", "Custodian", ANY_ADDRESS, custodian, inputs),
				state.custodian.kind === "unset" ? UNSET : custodian,
				[routeCondition(setupRoute, state.upgradeDelay)],
				EFFECTS.custodian,
			),
			slot: "set-custodian",
		},
		{
			...single(
				noticeRoute === "timelock" ? "propose-notice" : "set-notice",
				"Set the notice",
				noticeField,
				notice,
				[
					bound(
						"Notice ≤ 30d",
						noticeField.arg,
						(value) => value <= MAX_NOTICE,
					),
					upgradeBound(noticeField.arg, state.upgradeDelay),
					waits(noticeRoute),
				],
				EFFECTS.notice,
			),
			slot: "set-notice",
		},
		{
			...single(
				delayRoute === "timelock"
					? "propose-wind-down-delay"
					: "set-wind-down-delay",
				"Set the wind-down delay",
				delayField,
				delay,
				[
					bound(
						"Wind-down delay ≥ 7d",
						delayField.arg,
						(value) => value >= MIN_WIND_DOWN_DELAY,
					),
					bound(
						"Wind-down delay ≤ 90d",
						delayField.arg,
						(value) => value <= MAX_WIND_DOWN_DELAY,
					),
					waits(delayRoute),
				],
				EFFECTS.windDownDelay,
			),
			slot: "set-wind-down-delay",
		},
		{
			...single(
				setupRoute === "timelock"
					? "propose-min-epoch-duration"
					: "set-min-epoch-duration",
				"Set the minimum epoch duration",
				minEpochField,
				minEpoch?.kind === "unset" ? UNSET : minEpochSecs,
				[
					bound(
						`Minimum epoch duration ≥ ${formatDuration(MIN_EPOCH_DURATION)}`,
						minEpochField.arg,
						(value) => value >= MIN_EPOCH_DURATION,
					),
					bound(
						`Minimum epoch duration ≤ ${formatDuration(MAX_EPOCH_DURATION)}`,
						minEpochField.arg,
						(value) => value <= MAX_EPOCH_DURATION,
					),
					routeCondition(setupRoute, state.upgradeDelay),
				],
				EFFECTS.minEpochDuration,
			),
			slot: "set-min-epoch-duration",
		},
	] as const
}

function tokenSpecs(state: ConfigurationValues, inputs: ConfigurationInputs) {
	const compliance = known(state.compliance)
	const verifier = known(state.identityVerifier)
	const route = routeOf(state.tokenSetupOpen, true)
	const waits = [routeCondition(route, state.upgradeDelay)]
	return [
		{
			...single(
				route === "timelock" ? "propose-compliance" : "set-compliance",
				"Set the compliance contract",
				parsed(
					"compliance",
					"Compliance contract",
					CONTRACT,
					compliance,
					inputs,
				),
				compliance,
				waits,
			),
			slot: "set-compliance",
		},
		{
			...single(
				route === "timelock"
					? "propose-identity-verifier"
					: "set-identity-verifier",
				"Set the identity verifier",
				parsed(
					"identityVerifier",
					"Identity verifier",
					CONTRACT,
					verifier,
					inputs,
				),
				verifier,
				waits,
			),
			slot: "set-identity-verifier",
		},
	] as const
}

const toConfig = (limits: OracleLimits): OracleConfig => ({
	freshness_duration: limits.freshness,
	cooldown_secs: limits.cooldown,
	max_up_bps: limits.maxUpBps,
	max_down_bps: limits.maxDownBps,
	min_answer: limits.min,
	max_answer: limits.max,
})

const sameConfig = (a: OracleConfig, b: OracleConfig): boolean =>
	(Object.keys(a) as (keyof OracleConfig)[]).every((key) => a[key] === b[key])

const shortensFreshnessOnly = (
	current: OracleConfig,
	next: OracleConfig,
): boolean =>
	sameConfig(
		{ ...next, freshness_duration: current.freshness_duration },
		current,
	) && next.freshness_duration <= current.freshness_duration

type ParsedConfig = { [K in keyof OracleConfig]: Parsed<OracleConfig[K]> }

function oracleFields(
	current: OracleConfig | undefined,
	inputs: ConfigurationInputs,
): ParsedConfig {
	const field = <K extends keyof OracleConfig>(
		configKey: K,
		key: FieldKey,
		label: string,
		kind: Kind<OracleConfig[K]>,
	) =>
		parsed(
			key,
			label,
			kind,
			current === undefined ? undefined : current[configKey],
			inputs,
		)
	return {
		freshness_duration: field(
			"freshness_duration",
			"freshness",
			"Freshness window",
			DURATION,
		),
		cooldown_secs: field("cooldown_secs", "cooldown", "Cooldown", DURATION),
		max_up_bps: field("max_up_bps", "maxRise", "Largest rise", MOVE),
		max_down_bps: field("max_down_bps", "maxFall", "Largest fall", MOVE),
		min_answer: field("min_answer", "floor", "Price floor", PRICE),
		max_answer: field("max_answer", "ceiling", "Price ceiling", PRICE),
	}
}

const configOf = ({
	freshness_duration: freshness,
	cooldown_secs: cooldown,
	max_up_bps: rise,
	max_down_bps: fall,
	min_answer: floor,
	max_answer: ceiling,
}: ParsedConfig): OracleConfig | undefined =>
	freshness.arg === undefined ||
	cooldown.arg === undefined ||
	rise.arg === undefined ||
	fall.arg === undefined ||
	floor.arg === undefined ||
	ceiling.arg === undefined
		? undefined
		: {
				freshness_duration: freshness.arg,
				cooldown_secs: cooldown.arg,
				max_up_bps: rise.arg,
				max_down_bps: fall.arg,
				min_answer: floor.arg,
				max_answer: ceiling.arg,
			}

const withinBps = (value: number): boolean =>
	value >= MIN_BPS && value <= MAX_BPS

const oracleBounds = (fields: ParsedConfig): Condition[] => {
	const freshness = fields.freshness_duration.arg
	const cooldown = fields.cooldown_secs.arg
	const floor = fields.min_answer.arg
	const ceiling = fields.max_answer.arg
	const bpsRange = `${formatPercent(MIN_BPS)} to ${formatPercent(MAX_BPS)}`
	return [
		bound(
			`Freshness window ≥ ${formatDuration(MIN_SECS)}`,
			freshness,
			(value) => value >= MIN_SECS,
		),
		bound(
			`Freshness window ≤ ${formatDuration(MAX_FRESHNESS)}`,
			freshness,
			(value) => value <= MAX_FRESHNESS,
		),
		bound(
			`Cooldown ≥ ${formatDuration(MIN_SECS)}`,
			cooldown,
			(value) => value >= MIN_SECS,
		),
		{
			label: "Cooldown ≤ freshness window",
			met:
				freshness === undefined || cooldown === undefined
					? null
					: cooldown <= freshness,
		},
		bound(`Largest rise ${bpsRange}`, fields.max_up_bps.arg, withinBps),
		bound(`Largest fall ${bpsRange}`, fields.max_down_bps.arg, withinBps),
		bound("Price floor > 0", floor, (value) => value > 0n),
		{
			label: "Price ceiling ≥ floor",
			met:
				floor === undefined || ceiling === undefined ? null : ceiling >= floor,
		},
		bound(
			`Price ceiling ≤ ${formatScaled(MAX_CEILING as Price, PRICE_DECIMALS, 0)}`,
			ceiling,
			(value) => value <= MAX_CEILING,
		),
	]
}

function oracleSpec(
	state: ConfigurationValues,
	inputs: ConfigurationInputs,
): Spec<"set-oracle-config" | "propose-oracle-config"> & {
	arg: OracleConfig | undefined
	next: string
} {
	const current = state.oracle === null ? undefined : toConfig(state.oracle)
	const fields = oracleFields(current, inputs)
	const arg = configOf(fields)
	const unread = arg === undefined || current === undefined
	const changed = unread ? undefined : !sameConfig(arg, current)
	const waits = unread ? undefined : !shortensFreshnessOnly(current, arg)
	const route = routeOf(state.oracleSetupOpen, waits)
	const conditions = [
		...oracleBounds(fields),
		routeCondition(
			route,
			state.upgradeDelay,
			state.oracleSetupOpen === true
				? undefined
				: "Shortening the freshness window is instant",
		),
		differs(changed),
	]
	return {
		id: route === "timelock" ? "propose-oracle-config" : "set-oracle-config",
		slot: "set-oracle-config",
		label: "Set the oracle limits",
		conditions,
		outcome: null,
		fields: Object.values(fields).map((field) => field.field),
		ready: allMet(conditions),
		arg,
		next: "",
	}
}

export function toConfigurationActions(
	state: ConfigurationState,
	grants: Grant[],
	wallet: string,
	inputs: ConfigurationInputs = {},
): ConfigurationAction[] {
	if (state.status !== "ready" || grants.length === 0) return []
	const build = <Id extends ConfigurationAction["id"], T>(
		spec: Spec<Id> & { arg: T | undefined; next: string },
		grant: Grant,
	) => ({ ...toAction(spec, grant), arg: spec.arg, next: spec.next })

	const actions: ConfigurationAction[] = []
	const governance = grantFor(grants, ROLES.governance, wallet)
	if (governance !== undefined) {
		const [cap, custodian, notice, delay, minEpoch] = vaultSpecs(state, inputs)
		actions.push(
			build(cap, governance),
			build(custodian, governance),
			build(notice, governance),
			build(delay, governance),
			build(minEpoch, governance),
		)
	}
	const oracleAdmin = grantFor(grants, ROLES.oracleAdmin, wallet)
	if (oracleAdmin !== undefined)
		actions.push(build(oracleSpec(state, inputs), oracleAdmin))
	const tokenAdmin = grantFor(grants, ROLES.tokenAdmin, wallet)
	if (tokenAdmin !== undefined) {
		const [compliance, verifier] = tokenSpecs(state, inputs)
		actions.push(build(compliance, tokenAdmin), build(verifier, tokenAdmin))
	}
	return actions
}

const tile = (label: string, value: string | null, pending: boolean): Metric =>
	pending ? { label, value: null, pending } : { label, value }

const addressRow = (
	label: string,
	value: string | null,
	pending: boolean,
): AddressRow =>
	pending ? { label, address: null, pending } : { label, address: value }

const duration = (seconds: bigint | null): string | null =>
	seconds === null ? null : formatDuration(seconds)

export function toConfigurationGroups(
	state: ConfigurationState,
): ConfigurationGroup[] {
	const pending = state.status !== "ready"
	const values = state.status === "ready" ? state : null
	const limits = oracleLimitRows(values?.oracle ?? null).map((row) =>
		tile(row.label, row.value, pending),
	)
	return [
		{
			title: "Vault",
			strips: [
				[
					tile(
						"Deposit cap",
						depositCapValue(values?.depositCap ?? null),
						pending,
					),
					tile("Notice", duration(values?.notice ?? null), pending),
					tile(
						"Wind-down delay",
						duration(values?.windDownDelay ?? null),
						pending,
					),
					tile(
						"Upgrade delay",
						duration(values?.upgradeDelay ?? null),
						pending,
					),
				],
			],
			addresses: [
				values === null
					? { label: "Custodian", address: null, pending }
					: toCustodianRow(values.custodian),
			],
		},
		{
			title: "Oracle",
			strips: [limits.slice(0, 4), limits.slice(4)],
			addresses: [],
		},
		{
			title: "Share token",
			strips: [],
			addresses: [
				addressRow("Compliance contract", values?.compliance ?? null, pending),
				addressRow(
					"Identity verifier",
					values?.identityVerifier ?? null,
					pending,
				),
			],
		},
	]
}

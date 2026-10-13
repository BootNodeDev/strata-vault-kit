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
	depositCapValue,
	exactAmount,
	formatDuration,
	formatPercent,
	oracleLimitRows,
	parseDuration,
} from "./cycle"

export type FieldKey =
	| "depositCap"
	| "custodian"
	| "notice"
	| "windDownDelay"
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
	| Setter<"set-custodian" | "set-compliance" | "set-identity-verifier", string>
	| Setter<"set-notice" | "set-wind-down-delay", bigint>
	| Setter<"set-oracle-config", OracleConfig>

export type ConfigurationGroup = {
	title: string
	strips: Metric[][]
	addresses: AddressRow[]
}

export const EFFECTS = {
	custodian: "Treasury deploys to the new address from now on.",
	notice: "Applies to epochs closed from now on.",
	windDownDelay: "A proposed wind-down keeps its activation time.",
} as const

const DAY = 86_400n
const MAX_NOTICE = 30n * DAY
const MAX_WIND_DOWN_DELAY = 90n * DAY
const MAX_BPS = 10_000
const MAX_CEILING = ((1n << 127n) - 1n) / 10_000n
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

const CAP: Kind<bigint | null> = {
	parse: orNone((text) => parseUnits(text, AMOUNT_DECIMALS) ?? undefined),
	show: (cap) => (cap === null ? "No cap" : exactAmount(cap as Amount)),
	prefill: (cap) => (cap === null ? "" : exactAmount(cap as Amount)),
	placeholder: "No cap",
}

const PRICE: Kind<bigint> = {
	parse: (text) => parseUnits(text, PRICE_DECIMALS) ?? undefined,
	show: (price) => formatExact(price as Price, PRICE_DECIMALS),
	placeholder: "0.00",
}

const RISE: Kind<number> = {
	parse: parseBps,
	show: formatPercent,
	prefill: (bps) => String(bps / 100),
	placeholder: "10",
}

const FALL: Kind<number | null> = {
	parse: orNone(parseBps),
	show: (bps) => (bps === null ? "No limit" : formatPercent(bps)),
	prefill: (bps) => (bps === null ? "" : String(bps / 100)),
	placeholder: "No limit",
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

const bound = <T>(
	label: string,
	value: T | undefined,
	holds: (value: T) => boolean,
): Condition => ({ label, met: value === undefined ? null : holds(value) })

const differs = (changed: boolean | undefined): Condition => ({
	label: "Differs from current",
	met: changed ?? null,
})

const changedFrom = <T>(arg: T | undefined, current: T | undefined) =>
	arg === undefined || current === undefined ? undefined : arg !== current

function single<Id extends ConfigurationAction["id"], T>(
	id: Id,
	label: string,
	field: Parsed<T>,
	current: T | undefined,
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

const capOf = (state: ConfigurationValues): bigint | null | undefined => {
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

function vaultSpecs(state: ConfigurationValues, inputs: ConfigurationInputs) {
	const cap = capOf(state)
	const capField = parsed("depositCap", "Deposit cap", CAP, cap, inputs)
	const custodian = known(state.custodian)
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
	return [
		single("set-deposit-cap", "Set the deposit cap", capField, cap, [
			bound("Deposit cap ≥ 0", capField.arg, (value) => (value ?? 0n) >= 0n),
		]),
		single(
			"set-custodian",
			"Set the custodian",
			parsed("custodian", "Custodian", ANY_ADDRESS, custodian, inputs),
			custodian,
			[],
			EFFECTS.custodian,
		),
		single(
			"set-notice",
			"Set the notice",
			noticeField,
			notice,
			[
				bound("Notice ≤ 30d", noticeField.arg, (value) => value <= MAX_NOTICE),
				upgradeBound(noticeField.arg, state.upgradeDelay),
			],
			EFFECTS.notice,
		),
		single(
			"set-wind-down-delay",
			"Set the wind-down delay",
			delayField,
			delay,
			[
				bound(
					"Wind-down delay ≤ 90d",
					delayField.arg,
					(value) => value <= MAX_WIND_DOWN_DELAY,
				),
			],
			EFFECTS.windDownDelay,
		),
	] as const
}

function tokenSpecs(state: ConfigurationValues, inputs: ConfigurationInputs) {
	const compliance = known(state.compliance)
	const verifier = known(state.identityVerifier)
	return [
		single(
			"set-compliance",
			"Set the compliance contract",
			parsed("compliance", "Compliance contract", CONTRACT, compliance, inputs),
			compliance,
			[],
		),
		single(
			"set-identity-verifier",
			"Set the identity verifier",
			parsed(
				"identityVerifier",
				"Identity verifier",
				CONTRACT,
				verifier,
				inputs,
			),
			verifier,
			[],
		),
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
		max_up_bps: field("max_up_bps", "maxRise", "Largest rise", RISE),
		max_down_bps: field("max_down_bps", "maxFall", "Largest fall", FALL),
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

const oracleBounds = (fields: ParsedConfig): Condition[] => {
	const floor = fields.min_answer.arg
	const ceiling = fields.max_answer.arg
	return [
		bound(
			"Freshness window > 0",
			fields.freshness_duration.arg,
			(value) => value > 0n,
		),
		bound("Largest rise > 0", fields.max_up_bps.arg, (value) => value > 0),
		bound(
			"Largest rise ≤ 100%",
			fields.max_up_bps.arg,
			(value) => value <= MAX_BPS,
		),
		bound(
			"Largest fall ≤ 100%",
			fields.max_down_bps.arg,
			(value) => value === null || value <= MAX_BPS,
		),
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
): Spec<"set-oracle-config"> & { arg: OracleConfig | undefined; next: string } {
	const current = state.oracle === null ? undefined : toConfig(state.oracle)
	const fields = oracleFields(current, inputs)
	const arg = configOf(fields)
	const changed =
		arg === undefined || current === undefined
			? undefined
			: !sameConfig(arg, current)
	const conditions = [...oracleBounds(fields), differs(changed)]
	return {
		id: "set-oracle-config",
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
	) => ({ ...toAction(spec, grant, wallet), arg: spec.arg, next: spec.next })

	const actions: ConfigurationAction[] = []
	const governance = grantFor(grants, ROLES.governance, wallet)
	if (governance !== undefined) {
		const [cap, custodian, notice, delay] = vaultSpecs(state, inputs)
		actions.push(
			build(cap, governance),
			build(custodian, governance),
			build(notice, governance),
			build(delay, governance),
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
			addresses: [addressRow("Custodian", values?.custodian ?? null, pending)],
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

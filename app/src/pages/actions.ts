import { StrKey } from "@stellar/stellar-sdk"
import { type Grant, type Standing } from "../hooks/useAdminAuthority"

export const ROLES = {
	vaultGuardian: "vault guardian",
	governance: "vault governance",
	oracleGuardian: "oracle guardian",
	oracleAdmin: "oracle admin",
	tokenAdmin: "share-token admin",
	compliance: "share-token compliance",
	verifierAdmin: "identity-verifier admin",
} as const

export const parseAccount = (text: string): string | undefined => {
	const trimmed = text.trim()
	return StrKey.isValidEd25519PublicKey(trimmed) ||
		StrKey.isValidContract(trimmed)
		? trimmed
		: undefined
}

const HASH = /^[0-9a-f]{64}$/i

export const parseHash = (text: string): string | undefined => {
	const trimmed = text.trim()
	return HASH.test(trimmed) ? trimmed.toLowerCase() : undefined
}

export type Condition = {
	label: string
	met: boolean | null
	detail?: string
	unchanged?: true
}

export type ActionField = {
	kind?: undefined
	key?: string
	label: string
	placeholder: string
	value: string
	invalid: boolean
	max?: string
	text?: boolean
	current?: string
	next?: string | null
}

export type SelectField = {
	kind: "select"
	key: string
	label: string
	value: string
	options: { value: string; label: string }[]
}

export type ConfirmField = {
	kind: "confirm"
	key: string
	label: string
	value: string
	checked: boolean
}

export type RailField = ActionField | SelectField | ConfirmField

export type RailAction<F extends RailField = ActionField> = {
	id: string
	slot?: string
	label: string
	conditions: Condition[]
	outcome: string | null
	note?: string
	field?: ActionField
	fields?: F[]
	enabled: boolean
	unavailable?: string
	tone?: "danger"
	grant?: Grant
}

export type Readiness =
	| { kind: "ready" }
	| { kind: "blocked" }
	| { kind: "unchanged" }
	| { kind: "unavailable"; reason: string }

export const readiness = (action: RailAction<RailField>): Readiness => {
	if (action.enabled) return { kind: "ready" }
	if (action.unavailable !== undefined)
		return { kind: "unavailable", reason: action.unavailable }
	const unmet = action.conditions.filter((condition) => condition.met !== true)
	const [only] = unmet
	if (unmet.length === 1 && only?.unchanged === true && only.met === false)
		return { kind: "unchanged" }
	return { kind: "blocked" }
}

export const readyCount = (actions: RailAction<RailField>[]): number =>
	actions.filter((action) => action.enabled).length

export const allMet = (conditions: Condition[]): boolean =>
	conditions.every((condition) => condition.met === true)

export const describeStanding = (standing: Standing): string => {
	if (standing === "signs-alone") return "signs alone"
	if ("needs" in standing) return `1 of ${standing.needs} signatures`
	return `weight ${standing.weight} of threshold ${standing.threshold}`
}

export const grantFor = (
	grants: Grant[],
	role: string,
	wallet: string,
): Grant | undefined => {
	const ofRole = grants.filter((grant) => grant.role === role)
	return ofRole.find((grant) => grant.authority === wallet) ?? ofRole[0]
}

export type Spec<Id extends string, F extends RailField = ActionField> = {
	id: Id
	slot?: string
	label: string
	conditions: Condition[]
	outcome: string | null
	note?: string
	danger?: boolean
	fields?: F[]
	ready?: boolean
}

export const toAction = <Id extends string, F extends RailField>(
	spec: Spec<Id, F>,
	grant: Grant,
): RailAction<F> & { id: Id } => ({
	id: spec.id,
	...(spec.slot === undefined ? {} : { slot: spec.slot }),
	label: spec.label,
	conditions: spec.conditions,
	outcome: spec.outcome,
	...(spec.note === undefined ? {} : { note: spec.note }),
	...(spec.fields === undefined ? {} : { fields: spec.fields }),
	enabled:
		spec.ready !== false &&
		spec.conditions.every((condition) => condition.met !== false),
	...(spec.danger === true ? { tone: "danger" as const } : {}),
	grant,
})

export type Built<Id extends string, Arg> = Id extends string
	? RailAction<RailField> & { id: Id; arg: Arg; next: string }
	: never

export type BuiltSpec<Id extends string, Arg> = Spec<Id, RailField> & {
	arg: Arg
	next: string
}

export type Inputs = Partial<Record<string, string>>

export const confirmKey = (id: string): string => `${id}-confirm`

export const clearConfirmations = (inputs: Inputs, ids: string[]): Inputs => ({
	...inputs,
	...Object.fromEntries(ids.map((id) => [confirmKey(id), ""])),
})

export const withInput = (
	inputs: Inputs,
	id: string,
	key: string,
	value: string,
): Inputs => ({ ...clearConfirmations(inputs, [id]), [key]: value })

export type Confirmation = { field: ConfirmField; condition: Condition }

export function confirmation(
	key: string,
	label: string,
	value: string,
	inputs: Inputs,
): Confirmation {
	const checked = inputs[key] === value
	return {
		field: { kind: "confirm", key, label, value, checked },
		condition: { label: "Confirmed", met: checked },
	}
}

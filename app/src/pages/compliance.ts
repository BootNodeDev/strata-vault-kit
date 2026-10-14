import {
	addAmounts,
	AMOUNT_DECIMALS,
	type Amount,
	parseUnits,
	shortAddress,
	subtractAmounts,
} from "@stellar-scaffold/app-lib"
import { type Metric } from "../components/vault/MetricsStrip"
import { type Grant } from "../hooks/useAdminAuthority"
import { type TargetReads, type TargetState } from "../hooks/useComplianceState"
import {
	type AllowanceChange,
	type ForcedTransfer,
	type SharesChange,
} from "../hooks/useComplianceTransactions"
import { type Allowance } from "../hooks/useIsAllowed"
import {
	allMet,
	type Condition,
	type Confirmation,
	confirmation,
	confirmKey,
	grantFor,
	type Inputs,
	parseAccount,
	type RailAction,
	type RailField,
	ROLES,
	type Spec,
	toAction,
} from "./actions"
import { exactAmount } from "./cycle"

type AllowActionId = "allow-address" | "disallow-address"
type FreezeActionId = "freeze-address" | "unfreeze-address"
type AddressActionId = AllowActionId | FreezeActionId
type SharesActionId = "freeze-shares" | "unfreeze-shares"

export type ComplianceActionId =
	AddressActionId | SharesActionId | "force-transfer"

export const COMPLIANCE_ACTION_IDS: ComplianceActionId[] = [
	"allow-address",
	"disallow-address",
	"freeze-address",
	"unfreeze-address",
	"freeze-shares",
	"unfreeze-shares",
	"force-transfer",
]

type Built<Id extends string, Arg> = Id extends string
	? RailAction<RailField> & { id: Id; arg: Arg; next: string }
	: never

export type ComplianceAction =
	| Built<AllowActionId, AllowanceChange | undefined>
	| Built<FreezeActionId, string | undefined>
	| Built<SharesActionId, SharesChange | undefined>
	| Built<"force-transfer", ForcedTransfer | undefined>

export type ComplianceState = {
	verifier: string | null
	target: string | undefined
	reads: TargetState
	vault: string
	destination: Allowance
}

type BuiltSpec<Id extends string, Arg> = Spec<Id, RailField> & {
	arg: Arg
	next: string
}

const DESTINATION_KEY = "force-transfer-destination"

export const destinationOf = (inputs: Inputs): string | undefined =>
	parseAccount(inputs[DESTINATION_KEY] ?? "")

const yesNo = (value: boolean): string => (value ? "Yes" : "No")

const targetEntered = (target: string | undefined): Condition => ({
	label: "Target address entered",
	met: target === undefined ? null : true,
})

const readsOf = (state: ComplianceState): TargetReads | undefined =>
	state.reads.status === "ready" ? state.reads.reads : undefined

const allowedOf = (allowance: Allowance | undefined): boolean | null =>
	allowance === "allowed" || allowance === "not-allowed"
		? allowance === "allowed"
		: null

const freeOf = (reads: TargetReads | undefined): Amount | null =>
	reads?.shares == null || reads.frozenShares === null
		? null
		: subtractAmounts(reads.shares, reads.frozenShares)

const vaultConfirmation = (
	id: ComplianceActionId,
	label: string,
	state: ComplianceState,
	inputs: Inputs,
	detail = "",
): Confirmation | undefined =>
	state.target !== undefined && state.target === state.vault
		? confirmation(confirmKey(id), label, `${state.target}${detail}`, inputs)
		: undefined

type Toggle<Id extends AddressActionId> = {
	id: Id
	label: string
	condition: string
	subject: string
	wanted: boolean
	warning?: string
}

const TOGGLES: { [Id in AddressActionId]: Toggle<Id> } = {
	"allow-address": {
		id: "allow-address",
		label: "Allow the address",
		condition: "Not allowlisted",
		subject: "Allowlisted",
		wanted: true,
	},
	"disallow-address": {
		id: "disallow-address",
		label: "Remove from the allowlist",
		condition: "Allowlisted",
		subject: "Allowlisted",
		wanted: false,
		warning: "Stops the vault receiving shares.",
	},
	"freeze-address": {
		id: "freeze-address",
		label: "Freeze the address",
		condition: "Not frozen",
		subject: "Frozen",
		wanted: true,
		warning: "Stops the vault moving shares.",
	},
	"unfreeze-address": {
		id: "unfreeze-address",
		label: "Unfreeze the address",
		condition: "Frozen",
		subject: "Frozen",
		wanted: false,
	},
}

function toggleSpec<Id extends AddressActionId>(
	toggle: Toggle<Id>,
	current: boolean | null,
	state: ComplianceState,
	inputs: Inputs,
): BuiltSpec<Id, string | undefined> {
	const { target } = state
	const entered = targetEntered(target)
	const changes = current === null ? null : current !== toggle.wanted
	const confirm =
		toggle.warning === undefined
			? undefined
			: vaultConfirmation(toggle.id, toggle.warning, state, inputs)
	const required =
		confirm === undefined ? [entered] : [entered, confirm.condition]
	return {
		id: toggle.id,
		label: toggle.label,
		conditions: [
			entered,
			{ label: toggle.condition, met: changes, unchanged: true },
			...(confirm === undefined ? [] : [confirm.condition]),
		],
		outcome:
			current === null || changes !== true
				? null
				: `${toggle.subject} ${yesNo(current)} → ${yesNo(toggle.wanted)}.`,
		...(confirm === undefined ? {} : { fields: [confirm.field], danger: true }),
		ready: allMet(required),
		arg: target,
		next: target === undefined ? "" : shortAddress(target),
	}
}

function allowSpec<Id extends AllowActionId>(
	toggle: Toggle<Id>,
	current: boolean | null,
	state: ComplianceState,
	inputs: Inputs,
): BuiltSpec<Id, AllowanceChange | undefined> {
	const spec = toggleSpec(toggle, current, state, inputs)
	const { verifier } = state
	return {
		...spec,
		arg:
			spec.arg === undefined || verifier === null
				? undefined
				: { verifier, account: spec.arg },
	}
}

type AmountEntry = {
	text: string
	amount: Amount | undefined
	field: RailField
}

const amountEntry = (
	key: string,
	inputs: Inputs,
	max: Amount | null,
): AmountEntry => {
	const text = inputs[key] ?? ""
	const amount = parseUnits(text, AMOUNT_DECIMALS) ?? undefined
	return {
		text,
		amount,
		field: {
			key,
			label: "Amount",
			placeholder: "0.00",
			value: text,
			invalid: text.trim() !== "" && amount === undefined,
			...(max === null || max <= 0n ? {} : { max: exactAmount(max) }),
		},
	}
}

const positive = ({ text, amount }: AmountEntry): Condition => ({
	label: "Amount above 0",
	met: text.trim() === "" ? null : amount !== undefined && amount > 0n,
})

const atMost = (
	label: string,
	amount: Amount | undefined,
	limit: Amount | null,
): Condition => ({
	label,
	met: amount === undefined || limit === null ? null : amount <= limit,
	...(limit === null ? {} : { detail: exactAmount(limit) }),
})

function sharesSpec(
	id: SharesActionId,
	state: ComplianceState,
	inputs: Inputs,
): BuiltSpec<SharesActionId, SharesChange | undefined> {
	const { target } = state
	const reads = readsOf(state)
	const frozen = reads?.frozenShares ?? null
	const freezing = id === "freeze-shares"
	const limit = freezing ? freeOf(reads) : frozen
	const entry = amountEntry(`${id}-amount`, inputs, limit)
	const { amount } = entry
	const entered = targetEntered(target)
	const bound = atMost(
		freezing ? "Amount ≤ free shares" : "Amount ≤ frozen shares",
		amount,
		limit,
	)
	const confirm = freezing
		? vaultConfirmation(
				id,
				"Locks shares the vault holds.",
				state,
				inputs,
				`:${entry.text}`,
			)
		: undefined
	const required = [
		entered,
		positive(entry),
		...(confirm ? [confirm.condition] : []),
	]
	const fields: RailField[] = [entry.field, ...(confirm ? [confirm.field] : [])]
	const valid = target !== undefined && amount !== undefined && amount > 0n
	return {
		id,
		label: freezing ? "Freeze shares" : "Unfreeze shares",
		conditions: [
			entered,
			positive(entry),
			bound,
			...(confirm ? [confirm.condition] : []),
		],
		outcome:
			!valid || frozen === null || bound.met !== true
				? null
				: `Frozen shares ${exactAmount(frozen)} → ${exactAmount(freezing ? addAmounts(frozen, amount) : subtractAmounts(frozen, amount))}.`,
		fields,
		...(confirm === undefined ? {} : { danger: true }),
		ready: allMet(required),
		arg: valid ? { account: target, amount } : undefined,
		next: valid
			? `${exactAmount(amount)} shares of ${shortAddress(target)}`
			: "",
	}
}

const transferOutcome = (
	reads: TargetReads | undefined,
	amount: Amount,
): string | null => {
	const free = freeOf(reads)
	if (reads?.shares == null || reads.frozenShares === null || free === null)
		return null
	const shares = `Shares ${exactAmount(reads.shares)} → ${exactAmount(subtractAmounts(reads.shares, amount))}.`
	if (amount <= free) return shares
	const unfrozen = subtractAmounts(
		reads.frozenShares,
		subtractAmounts(amount, free),
	)
	return `${shares} Frozen shares ${exactAmount(reads.frozenShares)} → ${exactAmount(unfrozen)}.`
}

function forceTransferSpec(
	state: ComplianceState,
	inputs: Inputs,
): BuiltSpec<"force-transfer", ForcedTransfer | undefined> {
	const id = "force-transfer"
	const { target } = state
	const reads = readsOf(state)
	const shares = reads?.shares ?? null
	const destinationText = inputs[DESTINATION_KEY] ?? ""
	const destination = destinationOf(inputs)
	const entry = amountEntry(`${id}-amount`, inputs, shares)
	const { amount } = entry
	const entered = targetEntered(target)
	const destinationEntered: Condition = {
		label: "Destination entered",
		met: destinationText.trim() === "" ? null : destination !== undefined,
	}
	const bound = atMost("Amount ≤ shares", amount, shares)
	const confirm = vaultConfirmation(
		id,
		"Drains the vault's redemption escrow.",
		state,
		inputs,
		`:${destinationText}:${entry.text}`,
	)
	const required = [
		entered,
		destinationEntered,
		positive(entry),
		...(confirm ? [confirm.condition] : []),
	]
	const valid =
		target !== undefined &&
		destination !== undefined &&
		amount !== undefined &&
		amount > 0n
	return {
		id,
		label: "Force a transfer",
		conditions: [
			entered,
			destinationEntered,
			positive(entry),
			bound,
			...(confirm ? [confirm.condition] : []),
		],
		outcome:
			!valid || bound.met !== true ? null : transferOutcome(reads, amount),
		...(destination !== undefined && state.destination === "not-allowed"
			? { note: "The destination is not allowlisted and cannot move them." }
			: {}),
		fields: [
			{
				key: DESTINATION_KEY,
				label: "Destination",
				placeholder: "Address",
				value: destinationText,
				invalid: destinationText.trim() !== "" && destination === undefined,
				text: true,
			},
			entry.field,
			...(confirm ? [confirm.field] : []),
		],
		...(confirm === undefined ? {} : { danger: true }),
		ready: allMet(required),
		arg: valid ? { from: target, to: destination, amount } : undefined,
		next: valid
			? `${exactAmount(amount)} shares from ${shortAddress(target)} to ${shortAddress(destination)}`
			: "",
	}
}

const build = <Id extends ComplianceActionId, Arg>(
	spec: BuiltSpec<Id, Arg>,
	grant: Grant,
	wallet: string,
) => ({ ...toAction(spec, grant, wallet), arg: spec.arg, next: spec.next })

export function toComplianceActions(
	state: ComplianceState,
	grants: Grant[],
	wallet: string,
	inputs: Inputs,
): ComplianceAction[] {
	const reads = readsOf(state)
	const allowed = allowedOf(reads?.allowance)
	const frozen = reads?.frozen ?? null
	const actions: ComplianceAction[] = []
	const admin = grantFor(grants, ROLES.verifierAdmin, wallet)
	if (admin !== undefined)
		actions.push(
			build(
				allowSpec(TOGGLES["allow-address"], allowed, state, inputs),
				admin,
				wallet,
			),
			build(
				allowSpec(TOGGLES["disallow-address"], allowed, state, inputs),
				admin,
				wallet,
			),
		)
	const officer = grantFor(grants, ROLES.compliance, wallet)
	if (officer !== undefined)
		actions.push(
			build(
				toggleSpec(TOGGLES["freeze-address"], frozen, state, inputs),
				officer,
				wallet,
			),
			build(
				toggleSpec(TOGGLES["unfreeze-address"], frozen, state, inputs),
				officer,
				wallet,
			),
			build(sharesSpec("freeze-shares", state, inputs), officer, wallet),
			build(sharesSpec("unfreeze-shares", state, inputs), officer, wallet),
			build(forceTransferSpec(state, inputs), officer, wallet),
		)
	return actions
}

const ALLOWANCE_LABELS: Record<Allowance, string | null> = {
	checking: null,
	unreadable: null,
	allowed: "Yes",
	"not-allowed": "No",
}

const tile = (label: string, value: string | null): Metric => ({ label, value })

export function toComplianceTiles(reads: TargetState): Metric[] {
	const labels = [
		"Allowlisted",
		"Frozen",
		"Shares",
		"Frozen shares",
		"Free shares",
	]
	if (reads.status === "none") return []
	if (reads.status === "checking")
		return labels.map((label) => ({ label, value: null, pending: true }))
	const { allowance, frozen, shares, frozenShares } = reads.reads
	const free = freeOf(reads.reads)
	return [
		tile("Allowlisted", ALLOWANCE_LABELS[allowance]),
		tile("Frozen", frozen === null ? null : yesNo(frozen)),
		tile("Shares", shares === null ? null : exactAmount(shares)),
		tile(
			"Frozen shares",
			frozenShares === null ? null : exactAmount(frozenShares),
		),
		tile("Free shares", free === null ? null : exactAmount(free)),
	]
}

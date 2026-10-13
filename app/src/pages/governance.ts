import { StrKey } from "@stellar/stellar-sdk"
import { type PendingTransfer, shortAddress } from "@stellar-scaffold/app-lib"
import { type Metric } from "../components/vault/MetricsStrip"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import {
	GOVERNED_CONTRACTS,
	type GovernedContract,
	type Handovers,
} from "../hooks/useGovernanceState"
import {
	type AdminOffer,
	type RoleChange,
} from "../hooks/useGovernanceTransactions"
import {
	allMet,
	type Condition,
	grantFor,
	type RailAction,
	type RailField,
	ROLES,
	type Spec,
	toAction,
} from "./actions"
import { formatTimestamp } from "./cycle"

type Operation = "grant" | "revoke"

type RoleActionId = `${Operation}-${GovernedContract}-role`
type OfferActionId =
	`hand-over-${GovernedContract}-admin` | `cancel-${GovernedContract}-handover`
type AcceptActionId = `accept-${GovernedContract}-admin`

export type GovernanceActionId = RoleActionId | OfferActionId | AcceptActionId

export const GOVERNANCE_ACTION_IDS: GovernanceActionId[] =
	GOVERNED_CONTRACTS.flatMap((contract) => [
		`grant-${contract}-role` as const,
		`revoke-${contract}-role` as const,
		`hand-over-${contract}-admin` as const,
		`cancel-${contract}-handover` as const,
		`accept-${contract}-admin` as const,
	])

type Built<Id extends string, Arg> = Id extends string
	? RailAction<RailField> & { id: Id; arg: Arg; next: string }
	: never

export type GovernanceAction =
	| Built<RoleActionId, RoleChange | undefined>
	| Built<OfferActionId, AdminOffer | undefined>
	| Built<AcceptActionId, undefined>

export type GovernanceInputs = Partial<Record<string, string>>

export type GovernanceState = {
	holders: RoleHolders
	vault: string
	handovers: Handovers
}

export type GovernanceGroup = { title: string; metrics: Metric[] }

type Holder = keyof RoleHolders

type RoleEntry = { role: string; label: string; holders: Holder }

type ContractEntry = {
	title: string
	subject: string
	name: string
	pendingGrant: string
	noun: string
	admin: { grant: string; label: string; holders: Holder }
	roles: [RoleEntry, ...RoleEntry[]]
}

const CONTRACTS: Record<GovernedContract, ContractEntry> = {
	vault: {
		title: "Vault",
		subject: "vault",
		name: "vault",
		pendingGrant: "vault pending admin",
		noun: "a vault role",
		admin: {
			grant: ROLES.governance,
			label: "Governance",
			holders: "vault governance",
		},
		roles: [
			{ role: "manager", label: "Manager", holders: "vault manager" },
			{ role: "treasury", label: "Treasury", holders: "vault treasury" },
			{ role: "guardian", label: "Guardian", holders: "vault guardian" },
		],
	},
	oracle: {
		title: "Oracle",
		subject: "oracle",
		name: "oracle",
		pendingGrant: "oracle pending admin",
		noun: "an oracle role",
		admin: {
			grant: ROLES.oracleAdmin,
			label: "Admin",
			holders: "oracle admin",
		},
		roles: [
			{ role: "attester", label: "Attester", holders: "oracle attester" },
			{ role: "guardian", label: "Guardian", holders: "oracle guardian" },
		],
	},
	token: {
		title: "Share token",
		subject: "share token",
		name: "share-token",
		pendingGrant: "share-token pending admin",
		noun: "a share-token role",
		admin: {
			grant: ROLES.tokenAdmin,
			label: "Admin",
			holders: "share-token admin",
		},
		roles: [
			{
				role: "compliance",
				label: "Compliance",
				holders: "share-token compliance",
			},
			{ role: "manager", label: "Manager", holders: "share-token manager" },
		],
	},
}

const SEPARATED_VAULT_ROLES: Holder[] = [
	"vault governance",
	"vault manager",
	"vault treasury",
	"vault guardian",
]

const WARNINGS = {
	vaultMinting: "Stops the vault minting and burning shares.",
	mergedRoles: "Merges two vault roles on one account.",
} as const

const parseAccount = (text: string): string | undefined => {
	const trimmed = text.trim()
	return StrKey.isValidEd25519PublicKey(trimmed) ||
		StrKey.isValidContract(trimmed)
		? trimmed
		: undefined
}

const holderList = (accounts: string[]): string =>
	accounts.length === 0 ? "none" : accounts.map(shortAddress).join(", ")

const capitalize = (text: string): string =>
	`${text.charAt(0).toUpperCase()}${text.slice(1)}`

const LEDGER_SECONDS = 5n
const DAY_IN_LEDGERS = 17_280
const DAY = 86_400n
const DEFAULT_DAYS = "7"
const WHOLE_DAYS = /^\d+$/

type Draft = {
	operation: Operation
	contract: GovernedContract
	entry: RoleEntry
	account: string
	state: GovernanceState
}

const warningOf = ({
	operation,
	contract,
	entry,
	account,
	state,
}: Draft): string | undefined => {
	if (
		operation === "revoke" &&
		entry.holders === "share-token manager" &&
		account === state.vault
	)
		return WARNINGS.vaultMinting
	const mergesRoles =
		operation === "grant" &&
		contract === "vault" &&
		SEPARATED_VAULT_ROLES.some(
			(other) =>
				other !== entry.holders && state.holders[other].includes(account),
		)
	return mergesRoles ? WARNINGS.mergedRoles : undefined
}

const resultingHolders = ({
	operation,
	entry,
	account,
	state,
}: Draft): string[] => {
	const current = state.holders[entry.holders]
	return operation === "grant"
		? [...current, account]
		: current.filter((holder) => holder !== account)
}

type Confirmation = { field: RailField; condition: Condition }

function confirmation(
	key: string,
	label: string,
	value: string,
	inputs: GovernanceInputs,
): Confirmation {
	const checked = inputs[key] === value
	return {
		field: { kind: "confirm", key, label, value, checked },
		condition: { label: "Confirmed", met: checked },
	}
}

const roleConfirmation = (
	draft: Draft,
	key: string,
	inputs: GovernanceInputs,
): Confirmation | undefined => {
	const label = warningOf(draft)
	return label === undefined
		? undefined
		: confirmation(key, label, `${draft.entry.role}:${draft.account}`, inputs)
}

const accountField = (key: string, text: string, label: string): RailField => ({
	key,
	label,
	placeholder: "Address",
	value: text,
	invalid: text.trim() !== "" && parseAccount(text) === undefined,
	text: true,
})

function roleSpec(
	operation: Operation,
	contract: GovernedContract,
	state: GovernanceState,
	inputs: GovernanceInputs,
): Spec<RoleActionId, RailField> & {
	arg: RoleChange | undefined
	next: string
} {
	const id: RoleActionId = `${operation}-${contract}-role`
	const { noun, roles } = CONTRACTS[contract]
	const roleKey = `${id}-role`
	const accountKey = `${id}-account`
	const entry =
		roles.find((candidate) => candidate.role === inputs[roleKey]) ?? roles[0]
	const text = inputs[accountKey] ?? ""
	const account = parseAccount(text)
	const holds =
		account === undefined
			? null
			: state.holders[entry.holders].includes(account)
	const fields: RailField[] = [
		{
			kind: "select",
			key: roleKey,
			label: "Role",
			value: entry.role,
			options: roles.map(({ role, label }) => ({ value: role, label })),
		},
		accountField(accountKey, text, "Account"),
	]
	const conditions: Condition[] = [
		operation === "grant"
			? {
					label: "Account does not hold the role",
					met: holds === null ? null : !holds,
				}
			: { label: "Account holds the role", met: holds },
	]
	const draft =
		account === undefined
			? undefined
			: { operation, contract, entry, account, state }
	const confirm =
		draft === undefined
			? undefined
			: roleConfirmation(draft, `${id}-confirm`, inputs)
	if (confirm !== undefined) {
		fields.push(confirm.field)
		conditions.push(confirm.condition)
	}
	const changes = holds === (operation === "revoke")
	return {
		id,
		label: `${capitalize(operation)} ${noun}`,
		conditions,
		outcome:
			draft === undefined || !changes
				? null
				: `${entry.label} holders: ${holderList(resultingHolders(draft))}`,
		fields,
		ready: allMet(conditions),
		...(confirm === undefined ? {} : { danger: true }),
		arg: account === undefined ? undefined : { role: entry.role, account },
		next:
			account === undefined
				? ""
				: `${entry.label} ${operation === "grant" ? "to" : "from"} ${shortAddress(account)}`,
	}
}

type Ledger = Extract<Handovers, { status: "ready" }>["ledger"]

const ledgerTime = (ledger: Ledger, sequence: number): bigint =>
	ledger.closeTime + BigInt(sequence - ledger.sequence) * LEDGER_SECONDS

const limitCondition = (
	ledger: Ledger | undefined,
	liveUntil: number | undefined,
): Condition[] => {
	if (ledger === undefined)
		return [{ label: "Expiry within the network limit", met: null }]
	if (ledger.maxLiveUntil === null) return []
	const maxDays = Math.floor(
		(ledger.maxLiveUntil - ledger.sequence) / DAY_IN_LEDGERS,
	)
	return [
		{
			label: `Expiry ≤ ${maxDays} days`,
			met: liveUntil === undefined ? null : liveUntil <= ledger.maxLiveUntil,
		},
	]
}

function handOverSpec(
	contract: GovernedContract,
	state: GovernanceState,
	inputs: GovernanceInputs,
): Spec<OfferActionId, RailField> & {
	arg: AdminOffer | undefined
	next: string
} {
	const id: OfferActionId = `hand-over-${contract}-admin`
	const accountKey = `${id}-account`
	const daysKey = `${id}-days`
	const text = inputs[accountKey] ?? ""
	const account = parseAccount(text)
	const daysText = inputs[daysKey] ?? DEFAULT_DAYS
	const days = WHOLE_DAYS.test(daysText.trim()) ? Number(daysText) : undefined
	const ledger =
		state.handovers.status === "ready" ? state.handovers.ledger : undefined
	const liveUntil =
		ledger === undefined || days === undefined
			? undefined
			: ledger.sequence + days * DAY_IN_LEDGERS
	const fields: RailField[] = [
		accountField(accountKey, text, "New admin"),
		{
			key: daysKey,
			label: "Expiry in days",
			placeholder: DEFAULT_DAYS,
			value: daysText,
			invalid: daysText.trim() !== "" && days === undefined,
		},
	]
	const conditions: Condition[] = [
		{
			label: "New admin entered",
			met: text.trim() === "" ? null : account !== undefined,
		},
		{ label: "Expiry ≥ 1 day", met: days === undefined ? null : days >= 1 },
		...limitCondition(ledger, liveUntil),
	]
	if (account !== undefined) {
		const confirm = confirmation(
			`${id}-confirm`,
			`Hands control of the ${CONTRACTS[contract].subject} to ${shortAddress(account)}.`,
			account,
			inputs,
		)
		fields.push(confirm.field)
		conditions.push(confirm.condition)
	}
	const offer =
		account === undefined || liveUntil === undefined || ledger === undefined
			? undefined
			: { newAdmin: account, liveUntilLedger: liveUntil }
	const outcome =
		offer === undefined || ledger === undefined || days === undefined
			? null
			: `${shortAddress(offer.newAdmin)} becomes admin once it accepts before ${formatTimestamp(
					ledger.closeTime + BigInt(days) * DAY,
				)}.`
	return {
		id,
		label: `Hand over ${CONTRACTS[contract].name} admin`,
		conditions,
		outcome,
		fields,
		danger: true,
		ready: allMet(conditions) && offer !== undefined,
		arg: offer,
		next: outcome ?? "",
	}
}

const cancelSpec = (
	contract: GovernedContract,
	pending: PendingTransfer,
): Spec<OfferActionId> & { arg: AdminOffer; next: string } => ({
	id: `cancel-${contract}-handover`,
	label: `Cancel the ${CONTRACTS[contract].name} handover`,
	conditions: [],
	outcome: `${shortAddress(pending.address)} can no longer accept.`,
	arg: { newAdmin: pending.address, liveUntilLedger: 0 },
	next: shortAddress(pending.address),
})

const acceptSpec = (
	contract: GovernedContract,
	ledger: Ledger,
	pending: PendingTransfer,
): Spec<AcceptActionId> & { arg: undefined; next: string } => ({
	id: `accept-${contract}-admin`,
	label: `Accept ${CONTRACTS[contract].name} admin`,
	conditions: [
		{
			label: "Offer open until",
			met: true,
			detail: formatTimestamp(ledgerTime(ledger, pending.liveUntilLedger)),
		},
	],
	outcome: `${shortAddress(pending.address)} becomes the admin of the ${CONTRACTS[contract].subject}.`,
	arg: undefined,
	next: CONTRACTS[contract].subject,
})

const build = <Id extends GovernanceActionId, Arg, F extends RailField>(
	spec: Spec<Id, F> & { arg: Arg; next: string },
	grant: Grant,
	wallet: string,
) => ({ ...toAction(spec, grant, wallet), arg: spec.arg, next: spec.next })

function adminActions(
	contract: GovernedContract,
	state: GovernanceState,
	grant: Grant,
	wallet: string,
	inputs: GovernanceInputs,
): GovernanceAction[] {
	const pending =
		state.handovers.status === "ready"
			? state.handovers.pending[contract]
			: null
	return [
		build(roleSpec("grant", contract, state, inputs), grant, wallet),
		build(roleSpec("revoke", contract, state, inputs), grant, wallet),
		build(handOverSpec(contract, state, inputs), grant, wallet),
		...(pending === null
			? []
			: [build(cancelSpec(contract, pending), grant, wallet)]),
	]
}

function acceptAction(
	contract: GovernedContract,
	state: GovernanceState,
	grants: Grant[],
	wallet: string,
): GovernanceAction[] {
	if (state.handovers.status !== "ready") return []
	const pending = state.handovers.pending[contract]
	const grant = grantFor(grants, CONTRACTS[contract].pendingGrant, wallet)
	if (
		pending === null ||
		pending.expired ||
		grant === undefined ||
		grant.authority !== pending.address
	)
		return []
	return [
		build(acceptSpec(contract, state.handovers.ledger, pending), grant, wallet),
	]
}

export function toGovernanceActions(
	state: GovernanceState,
	grants: Grant[],
	wallet: string,
	inputs: GovernanceInputs,
): GovernanceAction[] {
	return GOVERNED_CONTRACTS.flatMap((contract) => {
		const admin = grantFor(grants, CONTRACTS[contract].admin.grant, wallet)
		return [
			...(admin === undefined
				? []
				: adminActions(contract, state, admin, wallet, inputs)),
			...acceptAction(contract, state, grants, wallet),
		]
	})
}

const holdersMetric = (label: string, accounts: string[]): Metric =>
	accounts.length === 0
		? { label, value: "0" }
		: {
				label,
				value: String(accounts.length),
				note: holderList(accounts),
			}

const pendingMetric = (
	handovers: Handovers,
	contract: GovernedContract,
): Metric[] => {
	if (handovers.status !== "ready") return []
	const pending = handovers.pending[contract]
	if (pending === null) return []
	const at = formatTimestamp(
		ledgerTime(handovers.ledger, pending.liveUntilLedger),
	)
	return [
		{
			label: "Pending admin",
			value: shortAddress(pending.address),
			note: pending.expired ? `Expired ${at}` : `Expires ${at}`,
		},
	]
}

export const toGovernanceGroups = ({
	holders,
	handovers,
}: GovernanceState): GovernanceGroup[] =>
	GOVERNED_CONTRACTS.map((contract) => {
		const { title, admin, roles } = CONTRACTS[contract]
		return {
			title,
			metrics: [
				...[admin, ...roles].map((entry) =>
					holdersMetric(entry.label, holders[entry.holders]),
				),
				...pendingMetric(handovers, contract),
			],
		}
	})

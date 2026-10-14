import { StrKey } from "@stellar/stellar-sdk"
import { type PendingTransfer, shortAddress } from "@stellar-scaffold/app-lib"
import { type Metric } from "../components/vault/MetricsStrip"
import {
	GOVERNED_CONTRACTS,
	type GovernedContract,
} from "../hooks/pendingAdmins"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import {
	type Handovers,
	type PendingUpgrade,
	type Upgrades,
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
import { formatDuration, formatTimestamp, parseDuration } from "./cycle"

type Operation = "grant" | "revoke"

type RoleActionId = `${Operation}-${GovernedContract}-role`
type OfferActionId =
	`hand-over-${GovernedContract}-admin` | `cancel-${GovernedContract}-handover`
type AcceptActionId = `accept-${GovernedContract}-admin`

type ProposalActionId = "propose-code-upgrade" | "propose-upgrade-delay"
type VaultActionId =
	"apply-upgrade" | "cancel-upgrade" | "propose-wind-down" | "cancel-wind-down"

export type GovernanceActionId =
	| RoleActionId
	| OfferActionId
	| AcceptActionId
	| ProposalActionId
	| VaultActionId

const VAULT_ACTION_IDS: GovernanceActionId[] = [
	"propose-code-upgrade",
	"propose-upgrade-delay",
	"apply-upgrade",
	"cancel-upgrade",
	"propose-wind-down",
	"cancel-wind-down",
]

export const GOVERNANCE_ACTION_IDS: GovernanceActionId[] = [
	...GOVERNED_CONTRACTS.flatMap((contract) => [
		`grant-${contract}-role` as const,
		`revoke-${contract}-role` as const,
		`hand-over-${contract}-admin` as const,
		`cancel-${contract}-handover` as const,
		`accept-${contract}-admin` as const,
	]),
	...VAULT_ACTION_IDS,
]

type Built<Id extends string, Arg> = Id extends string
	? RailAction<RailField> & { id: Id; arg: Arg; next: string }
	: never

export type GovernanceAction =
	| Built<RoleActionId, RoleChange | undefined>
	| Built<OfferActionId, AdminOffer | undefined>
	| Built<AcceptActionId, undefined>
	| Built<"propose-code-upgrade", string | undefined>
	| Built<"propose-upgrade-delay", bigint | undefined>
	| Built<VaultActionId, undefined>

export type GovernanceInputs = Partial<Record<string, string>>

export type GovernanceState = {
	holders: RoleHolders
	vault: string
	handovers: Handovers
	upgrades: Upgrades
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

type ReadyUpgrades = Extract<Upgrades, { status: "ready" }>
type VaultSpec<Id extends string, Arg> = Spec<Id, RailField> & {
	arg: Arg
	next: string
}

const MIN_UPGRADE_DELAY = 7n * DAY
const MAX_UPGRADE_DELAY = 90n * DAY
const WASM_HASH = /^[0-9a-f]{64}$/i

const upgradeName = (proposal: PendingUpgrade): string =>
	proposal.kind === "code"
		? `Code ${shortAddress(proposal.hash)}`
		: `Delay ${formatDuration(proposal.secs)}`

const noPendingUpgrade = (upgrades?: ReadyUpgrades): Condition => ({
	label: "No pending upgrade",
	met: upgrades?.proposal === undefined ? null : upgrades.proposal === null,
})

const applyAfter = (upgrades?: ReadyUpgrades): string | null =>
	upgrades?.now == null || upgrades.delay === null
		? null
		: `Can apply after ${formatTimestamp(upgrades.now + upgrades.delay)}.`

const aboveNotice = (
	secs: bigint | undefined,
	notice: bigint | null | undefined,
): Condition => ({
	label:
		notice == null
			? "Delay ≥ notice"
			: `Delay ≥ notice ${formatDuration(notice)}`,
	met: secs === undefined || notice == null ? null : secs >= notice,
})

function codeUpgradeSpec(
	inputs: GovernanceInputs,
	upgrades?: ReadyUpgrades,
): VaultSpec<"propose-code-upgrade", string | undefined> {
	const key = "propose-code-upgrade-hash"
	const text = inputs[key] ?? ""
	const hash = WASM_HASH.test(text.trim())
		? text.trim().toLowerCase()
		: undefined
	const conditions = [
		{
			label: "Hash of 64 hex characters",
			met: text.trim() === "" ? null : hash !== undefined,
		},
		noPendingUpgrade(upgrades),
	]
	return {
		id: "propose-code-upgrade",
		label: "Propose a code upgrade",
		conditions,
		outcome: hash === undefined ? null : applyAfter(upgrades),
		fields: [
			{
				key,
				label: "Code hash",
				placeholder: "Wasm hash",
				value: text,
				invalid: text.trim() !== "" && hash === undefined,
				text: true,
			},
		],
		ready: allMet(conditions),
		arg: hash,
		next: hash === undefined ? "" : `Code ${shortAddress(hash)}`,
	}
}

function delayUpgradeSpec(
	inputs: GovernanceInputs,
	upgrades?: ReadyUpgrades,
): VaultSpec<"propose-upgrade-delay", bigint | undefined> {
	const key = "propose-upgrade-delay-secs"
	const current = upgrades?.delay ?? undefined
	const text =
		inputs[key] ?? (current === undefined ? "" : formatDuration(current, 4))
	const secs = parseDuration(text) ?? undefined
	const conditions: Condition[] = [
		{
			label: "Delay ≥ 7d",
			met: secs === undefined ? null : secs >= MIN_UPGRADE_DELAY,
		},
		{
			label: "Delay ≤ 90d",
			met: secs === undefined ? null : secs <= MAX_UPGRADE_DELAY,
		},
		aboveNotice(secs, upgrades?.notice),
		{
			label: "Differs from current",
			met:
				secs === undefined || current === undefined ? null : secs !== current,
			unchanged: true,
		},
		noPendingUpgrade(upgrades),
	]
	return {
		id: "propose-upgrade-delay",
		label: "Propose an upgrade delay",
		conditions,
		outcome: secs === undefined ? null : applyAfter(upgrades),
		fields: [
			{
				key,
				label: "Upgrade delay",
				placeholder: "7d",
				value: text,
				invalid: text.trim() !== "" && secs === undefined,
				text: true,
				current: current === undefined ? "—" : formatDuration(current),
				next: secs === undefined ? null : formatDuration(secs),
			},
		],
		ready: allMet(conditions),
		arg: secs,
		next: secs === undefined ? "" : `Delay ${formatDuration(secs)}`,
	}
}

const notPaused = (paused: ReadyUpgrades["paused"]): Condition => ({
	label: "Vault not paused",
	met: paused === "open" ? true : paused === "paused" ? false : null,
})

function applySpec(
	proposal: PendingUpgrade,
	upgrades: ReadyUpgrades,
	inputs: GovernanceInputs,
): VaultSpec<"apply-upgrade", undefined> {
	const conditions: Condition[] = [
		{
			label: "ETA reached",
			met: upgrades.now === null ? null : upgrades.now >= proposal.eta,
			detail: formatTimestamp(proposal.eta),
		},
		notPaused(upgrades.paused),
	]
	const fields: RailField[] = []
	if (proposal.kind === "delay")
		conditions.push(aboveNotice(proposal.secs, upgrades.notice))
	else {
		const confirm = confirmation(
			"apply-upgrade-confirm",
			"Replaces the vault's code.",
			proposal.hash,
			inputs,
		)
		fields.push(confirm.field)
		conditions.push(confirm.condition)
	}
	return {
		id: "apply-upgrade",
		label: "Apply the upgrade",
		conditions,
		outcome:
			proposal.kind === "delay"
				? `Upgrade delay becomes ${formatDuration(proposal.secs)}.`
				: null,
		fields,
		...(proposal.kind === "code" ? { danger: true } : {}),
		ready: allMet(conditions),
		arg: undefined,
		next: upgradeName(proposal),
	}
}

const cancelUpgradeSpec = (
	proposal: PendingUpgrade,
): VaultSpec<"cancel-upgrade", undefined> => ({
	id: "cancel-upgrade",
	label: "Cancel the upgrade",
	conditions: [],
	outcome: null,
	arg: undefined,
	next: upgradeName(proposal),
})

function windDownSpec(
	inputs: GovernanceInputs,
	upgrades?: ReadyUpgrades,
): VaultSpec<"propose-wind-down", undefined> {
	const phase = upgrades?.windDown.phase ?? null
	const confirm = confirmation(
		"propose-wind-down-confirm",
		"Starts closing the vault.",
		"wind-down",
		inputs,
	)
	const conditions: Condition[] = [
		{
			label: "No wind-down proposed",
			met: phase === null ? null : phase !== "proposed",
		},
		{
			label: "Wind-down not active",
			met: phase === null ? null : phase !== "active",
		},
		confirm.condition,
	]
	const delay = upgrades?.windDown.delay ?? null
	const outcome =
		upgrades?.now == null || delay === null
			? null
			: `Activates ${formatTimestamp(upgrades.now + delay)}.`
	return {
		id: "propose-wind-down",
		label: "Propose a wind-down",
		conditions,
		outcome,
		fields: [confirm.field],
		danger: true,
		ready: allMet(conditions),
		arg: undefined,
		next: outcome ?? "",
	}
}

const cancelWindDownSpec = (): VaultSpec<"cancel-wind-down", undefined> => ({
	id: "cancel-wind-down",
	label: "Cancel the wind-down",
	conditions: [],
	outcome: null,
	arg: undefined,
	next: "",
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
		...(contract === "vault" ? vaultActions(state, grant, wallet, inputs) : []),
	]
}

function vaultActions(
	state: GovernanceState,
	grant: Grant,
	wallet: string,
	inputs: GovernanceInputs,
): GovernanceAction[] {
	const upgrades =
		state.upgrades.status === "ready" ? state.upgrades : undefined
	const proposal = upgrades?.proposal ?? null
	return [
		build(codeUpgradeSpec(inputs, upgrades), grant, wallet),
		build(delayUpgradeSpec(inputs, upgrades), grant, wallet),
		...(proposal === null || upgrades === undefined
			? []
			: [
					build(applySpec(proposal, upgrades, inputs), grant, wallet),
					build(cancelUpgradeSpec(proposal), grant, wallet),
				]),
		build(windDownSpec(inputs, upgrades), grant, wallet),
		...(upgrades?.windDown.phase === "proposed"
			? [build(cancelWindDownSpec(), grant, wallet)]
			: []),
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
	const label = "Pending admin"
	if (handovers.status === "checking") return []
	if (handovers.status === "unreadable")
		return [{ label, value: null, note: "Could not be read" }]
	const pending = handovers.pending[contract]
	if (pending === null) return []
	const at = formatTimestamp(
		ledgerTime(handovers.ledger, pending.liveUntilLedger),
	)
	return [
		{
			label,
			value: shortAddress(pending.address),
			note: pending.expired ? `Expired ${at}` : `Expires ${at}`,
		},
	]
}

const upgradeMetrics = (upgrades: Upgrades): Metric[] => {
	if (upgrades.status !== "ready") return []
	const metrics: Metric[] = []
	const { proposal, windDown } = upgrades
	if (proposal != null)
		metrics.push({
			label: "Pending upgrade",
			value: upgradeName(proposal),
			note: `ETA ${formatTimestamp(proposal.eta)}`,
		})
	if (windDown.phase === "proposed" && windDown.activeAt !== null)
		metrics.push({
			label: "Wind-down",
			value: "Proposed",
			note: `Activates ${formatTimestamp(windDown.activeAt)}`,
		})
	return metrics
}

export const toGovernanceGroups = ({
	holders,
	handovers,
	upgrades,
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
				...(contract === "vault" ? upgradeMetrics(upgrades) : []),
			],
		}
	})

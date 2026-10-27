import { type PendingTransfer, shortAddress } from "@stellar-scaffold/app-lib"
import { type Metric } from "../components/vault/MetricsStrip"
import {
	GOVERNED_CONTRACTS,
	type GovernedContract,
} from "../hooks/pendingAdmins"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import { type Handovers, type Upgrades } from "../hooks/useGovernanceState"
import {
	type AdminOffer,
	type RoleChange,
} from "../hooks/useGovernanceTransactions"
import { type TimelockedContract } from "../hooks/useSetupOpen"
import {
	allMet,
	type Built,
	type BuiltSpec,
	type Condition,
	type Confirmation,
	confirmation,
	confirmKey,
	grantFor,
	type Inputs,
	parseAccount,
	parseHash,
	type RailField,
	ROLES,
	type Spec,
	toAction,
} from "./actions"
import { DAY, formatDuration, formatTimestamp, parseDuration } from "./cycle"
import {
	applyChangeSpec,
	cancelChangeSpec,
	type PendingChange,
	pendingChangeMetrics,
	QUEUES,
} from "./pendingChanges"
import { type Route, routeCondition, routeOf } from "./timelock"

type Operation = "grant" | "revoke"

type RoleActionId = `${Operation}-${GovernedContract}-role`
type OfferActionId =
	`hand-over-${GovernedContract}-admin` | `cancel-${GovernedContract}-handover`
type AcceptActionId = `accept-${GovernedContract}-admin`

type ProposalActionId = "propose-code-upgrade" | "propose-upgrade-delay"
type ProposedRoleActionId =
	| "propose-grant-role"
	| "propose-revoke-role"
	| "propose-token-grant-role"
	| "propose-token-revoke-role"
type ProposedAdminActionId = "propose-admin" | "propose-token-admin"
type ChangeActionId =
	| "apply-change"
	| "cancel-change"
	| "apply-token-change"
	| "cancel-token-change"
type VaultActionId = "propose-wind-down" | "cancel-wind-down"

export type GovernanceActionId =
	| RoleActionId
	| OfferActionId
	| AcceptActionId
	| ProposalActionId
	| ProposedRoleActionId
	| ProposedAdminActionId
	| ChangeActionId
	| VaultActionId

const VAULT_ACTION_IDS: GovernanceActionId[] = [
	"propose-grant-role",
	"propose-revoke-role",
	"propose-admin",
	"propose-code-upgrade",
	"propose-upgrade-delay",
	"apply-change",
	"cancel-change",
	"propose-wind-down",
	"cancel-wind-down",
]

const TOKEN_ACTION_IDS: GovernanceActionId[] = [
	"propose-token-grant-role",
	"propose-token-revoke-role",
	"propose-token-admin",
	"apply-token-change",
	"cancel-token-change",
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
	...TOKEN_ACTION_IDS,
]

export type GovernanceAction =
	| Built<RoleActionId | ProposedRoleActionId, RoleChange | undefined>
	| Built<OfferActionId, AdminOffer | undefined>
	| Built<ProposedAdminActionId, string | undefined>
	| Built<ChangeActionId, number>
	| Built<AcceptActionId, undefined>
	| Built<"propose-code-upgrade", string | undefined>
	| Built<"propose-upgrade-delay", bigint | undefined>
	| Built<VaultActionId, undefined>

export type GovernanceState = {
	holders: RoleHolders
	vault: string
	handovers: Handovers
	upgrades: Record<TimelockedContract, Upgrades>
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

const holderList = (accounts: string[]): string =>
	accounts.length === 0 ? "none" : accounts.map(shortAddress).join(", ")

const capitalize = (text: string): string =>
	`${text.charAt(0).toUpperCase()}${text.slice(1)}`

const LEDGER_SECONDS = 5n
const MIN_EXPIRY = 60n
const U32_MAX = 4_294_967_295
const DEFAULT_EXPIRY = "7d"

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

const roleConfirmation = (
	draft: Draft,
	key: string,
	inputs: Inputs,
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

type ReadyUpgrades = Extract<Upgrades, { status: "ready" }>

const readyUpgrades = (
	state: GovernanceState,
	contract: TimelockedContract,
): ReadyUpgrades | undefined => {
	const upgrades = state.upgrades[contract]
	return upgrades.status === "ready" ? upgrades : undefined
}

const isTimelocked = (
	contract: GovernedContract,
): contract is TimelockedContract => contract !== "oracle"

const MAX_PENDING = 16

const underCapacity = (upgrades?: ReadyUpgrades): Condition => ({
	label: `Under ${MAX_PENDING} pending changes`,
	met:
		upgrades?.pending === undefined
			? null
			: upgrades.pending.length < MAX_PENDING,
})

const windDownInactive = (upgrades?: ReadyUpgrades): Condition => {
	const phase = upgrades?.windDown.phase ?? null
	return {
		label: "Wind-down not active",
		met: phase === null ? null : phase !== "active",
	}
}

const routeFor = (
	state: GovernanceState,
	contract: TimelockedContract,
	waits: boolean,
): Route => routeOf(readyUpgrades(state, contract)?.setupOpen ?? null, waits)

const routeConditions = (
	state: GovernanceState,
	contract: TimelockedContract,
	route: Route,
	atOnce?: string,
): Condition[] => {
	const upgrades = readyUpgrades(state, contract)
	const line = routeCondition(route, upgrades?.delay ?? null, atOnce)
	return route === "timelock"
		? [line, underCapacity(upgrades), windDownInactive(upgrades)]
		: [line]
}

const PROPOSED_ROLES: Record<
	TimelockedContract,
	Record<Operation, ProposedRoleActionId>
> = {
	vault: { grant: "propose-grant-role", revoke: "propose-revoke-role" },
	token: {
		grant: "propose-token-grant-role",
		revoke: "propose-token-revoke-role",
	},
}

const PROPOSED_ADMINS: Record<TimelockedContract, ProposedAdminActionId> = {
	vault: "propose-admin",
	token: "propose-token-admin",
}

function roleSpec(
	operation: Operation,
	contract: GovernedContract,
	state: GovernanceState,
	inputs: Inputs,
): BuiltSpec<RoleActionId | ProposedRoleActionId, RoleChange | undefined> {
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
			: roleConfirmation(draft, confirmKey(id), inputs)
	if (confirm !== undefined) {
		fields.push(confirm.field)
		conditions.push(confirm.condition)
	}
	const waits = operation === "grant" || entry.role === "manager"
	let proposed: ProposedRoleActionId | undefined
	if (isTimelocked(contract)) {
		const route = routeFor(state, contract, waits)
		conditions.push(
			...routeConditions(
				state,
				contract,
				route,
				waits ? undefined : "Revoking this role is instant",
			),
		)
		if (route === "timelock") proposed = PROPOSED_ROLES[contract][operation]
	}
	const changes = holds === (operation === "revoke")
	return {
		id: proposed ?? id,
		slot: id,
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

const LIMIT_LABEL = "Expiry within the network limit"

const limitCondition = (
	ledger: Ledger | undefined,
	liveUntil: bigint | undefined,
): Condition => {
	if (ledger === undefined) return { label: LIMIT_LABEL, met: null }
	const limit = Math.min(ledger.maxLiveUntil ?? U32_MAX, U32_MAX)
	return {
		label:
			ledger.maxLiveUntil === null
				? LIMIT_LABEL
				: `Expiry ≤ ${formatDuration(BigInt(limit - ledger.sequence) * LEDGER_SECONDS)}`,
		met: liveUntil === undefined ? null : liveUntil <= BigInt(limit),
	}
}

function handOverSpec(
	contract: GovernedContract,
	state: GovernanceState,
	inputs: Inputs,
): BuiltSpec<OfferActionId, AdminOffer | undefined> {
	const id: OfferActionId = `hand-over-${contract}-admin`
	const accountKey = `${id}-account`
	const expiryKey = `${id}-expiry`
	const text = inputs[accountKey] ?? ""
	const account = parseAccount(text)
	const expiryText = inputs[expiryKey] ?? DEFAULT_EXPIRY
	const secs = /^\s*\d+\s*$/.test(expiryText)
		? undefined
		: (parseDuration(expiryText) ?? undefined)
	const ledger =
		state.handovers.status === "ready" ? state.handovers.ledger : undefined
	const liveUntil =
		ledger === undefined || secs === undefined
			? undefined
			: BigInt(ledger.sequence) + secs / LEDGER_SECONDS
	const fields: RailField[] = [
		accountField(accountKey, text, "New admin"),
		{
			key: expiryKey,
			label: "Expiry",
			placeholder: DEFAULT_EXPIRY,
			value: expiryText,
			invalid: expiryText.trim() !== "" && secs === undefined,
			text: true,
		},
	]
	const conditions: Condition[] = [
		{
			label: "New admin entered",
			met: text.trim() === "" ? null : account !== undefined,
		},
		{
			label: "Expiry has a unit, e.g. 7d",
			met: expiryText.trim() === "" ? null : secs !== undefined,
		},
		{
			label: `Expiry ≥ ${formatDuration(MIN_EXPIRY)}`,
			met: secs === undefined ? null : secs >= MIN_EXPIRY,
		},
		limitCondition(ledger, liveUntil),
		...(isTimelocked(contract)
			? routeConditions(state, contract, routeFor(state, contract, true))
			: []),
	]
	if (account !== undefined) {
		const confirm = confirmation(
			confirmKey(id),
			`Hands control of the ${CONTRACTS[contract].subject} to ${shortAddress(account)}.`,
			`${account}:${secs ?? ""}`,
			inputs,
		)
		fields.push(confirm.field)
		conditions.push(confirm.condition)
	}
	const offer =
		account === undefined || liveUntil === undefined || liveUntil > U32_MAX
			? undefined
			: { newAdmin: account, liveUntilLedger: Number(liveUntil) }
	const outcome =
		offer === undefined || ledger === undefined
			? null
			: `${shortAddress(offer.newAdmin)} becomes admin once it accepts before ${formatTimestamp(
					ledgerTime(ledger, offer.liveUntilLedger),
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

function proposeAdminSpec(
	contract: TimelockedContract,
	state: GovernanceState,
	inputs: Inputs,
): BuiltSpec<ProposedAdminActionId, string | undefined> {
	const slot: OfferActionId = `hand-over-${contract}-admin`
	const text = inputs[`${slot}-account`] ?? ""
	const account = parseAccount(text)
	const fields: RailField[] = [
		accountField(`${slot}-account`, text, "New admin"),
	]
	const conditions: Condition[] = [
		{
			label: "New admin entered",
			met: text.trim() === "" ? null : account !== undefined,
		},
		...routeConditions(state, contract, "timelock"),
	]
	if (account !== undefined) {
		const confirm = confirmation(
			confirmKey(slot),
			`Hands control of the ${CONTRACTS[contract].subject} to ${shortAddress(account)}.`,
			account,
			inputs,
		)
		fields.push(confirm.field)
		conditions.push(confirm.condition)
	}
	return {
		id: PROPOSED_ADMINS[contract],
		slot,
		label: `Hand over ${CONTRACTS[contract].name} admin`,
		conditions,
		outcome:
			account === undefined
				? null
				: `${shortAddress(account)} can accept the admin once the change applies.`,
		fields,
		danger: true,
		ready: allMet(conditions),
		arg: account,
		next: account === undefined ? "" : shortAddress(account),
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

const MIN_UPGRADE_DELAY = 7n * DAY
const MAX_UPGRADE_DELAY = 90n * DAY
const CODE_CHANGES = new Set(["Upgrade", "UpgradeDelay"])

const proposalChecks = (upgrades?: ReadyUpgrades): Condition[] => [
	{
		label: "Setup closed",
		met: upgrades?.setupOpen == null ? null : !upgrades.setupOpen,
	},
	{
		label: "No pending code change",
		met:
			upgrades?.pending === undefined
				? null
				: !upgrades.pending.some(({ change }) => CODE_CHANGES.has(change.tag)),
	},
	underCapacity(upgrades),
	windDownInactive(upgrades),
	routeCondition("timelock", upgrades?.delay ?? null),
]

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
	inputs: Inputs,
	upgrades?: ReadyUpgrades,
): BuiltSpec<"propose-code-upgrade", string | undefined> {
	const key = "propose-code-upgrade-hash"
	const text = inputs[key] ?? ""
	const hash = parseHash(text)
	const conditions = [
		{
			label: "Hash of 64 hex characters",
			met: text.trim() === "" ? null : hash !== undefined,
		},
		...proposalChecks(upgrades),
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
		next: hash === undefined ? "" : `Code ${hash}`,
	}
}

function delayUpgradeSpec(
	inputs: Inputs,
	upgrades?: ReadyUpgrades,
): BuiltSpec<"propose-upgrade-delay", bigint | undefined> {
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
		...proposalChecks(upgrades),
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

const belowUpgradeDelay = (
	notice: bigint | undefined,
	delay: bigint | null,
): Condition => ({
	label:
		delay === null
			? "Notice ≤ upgrade delay"
			: `Notice ≤ upgrade delay ${formatDuration(delay)}`,
	met: notice === undefined || delay === null ? null : notice <= delay,
})

const notPaused = (paused: ReadyUpgrades["paused"]): Condition => ({
	label: "Vault not paused",
	met: paused === "open" ? true : paused === "paused" ? false : null,
})

const secsOf = ({ values }: PendingChange["change"]): bigint | undefined =>
	typeof values[0] === "bigint" ? values[0] : undefined

function applyChecks(
	{ change }: PendingChange,
	upgrades: ReadyUpgrades,
): Condition[] {
	const checks = [notPaused(upgrades.paused), windDownInactive(upgrades)]
	if (change.tag === "UpgradeDelay")
		checks.push(aboveNotice(secsOf(change), upgrades.notice))
	if (change.tag === "Notice")
		checks.push(belowUpgradeDelay(secsOf(change), upgrades.delay))
	return checks
}

function windDownSpec(
	inputs: Inputs,
	upgrades?: ReadyUpgrades,
): BuiltSpec<"propose-wind-down", undefined> {
	const phase = upgrades?.windDown.phase ?? null
	const confirm = confirmation(
		confirmKey("propose-wind-down"),
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

const cancelWindDownSpec = (): BuiltSpec<"cancel-wind-down", undefined> => ({
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
) => ({ ...toAction(spec, grant), arg: spec.arg, next: spec.next })

function adminActions(
	contract: GovernedContract,
	state: GovernanceState,
	grant: Grant,
	inputs: Inputs,
): GovernanceAction[] {
	const pending =
		state.handovers.status === "ready"
			? state.handovers.pending[contract]
			: null
	const offer =
		isTimelocked(contract) && routeFor(state, contract, true) === "timelock"
			? build(proposeAdminSpec(contract, state, inputs), grant)
			: build(handOverSpec(contract, state, inputs), grant)
	return [
		build(roleSpec("grant", contract, state, inputs), grant),
		build(roleSpec("revoke", contract, state, inputs), grant),
		offer,
		...(pending === null ? [] : [build(cancelSpec(contract, pending), grant)]),
		...(contract === "vault" ? vaultActions(state, grant, inputs) : []),
		...(contract === "token"
			? changeActions("token", state, grant, inputs)
			: []),
	]
}

function changeActions(
	contract: TimelockedContract,
	state: GovernanceState,
	grant: Grant,
	inputs: Inputs,
): GovernanceAction[] {
	const upgrades = readyUpgrades(state, contract)
	if (upgrades === undefined) return []
	const queue = QUEUES[contract]
	return (upgrades.pending ?? []).flatMap((pending) => [
		build(
			applyChangeSpec(
				queue,
				pending,
				upgrades.now,
				applyChecks(pending, upgrades),
				inputs,
			),
			grant,
		),
		build(cancelChangeSpec(queue, pending), grant),
	])
}

function vaultActions(
	state: GovernanceState,
	grant: Grant,
	inputs: Inputs,
): GovernanceAction[] {
	const upgrades = readyUpgrades(state, "vault")
	return [
		build(codeUpgradeSpec(inputs, upgrades), grant),
		build(delayUpgradeSpec(inputs, upgrades), grant),
		...changeActions("vault", state, grant, inputs),
		build(windDownSpec(inputs, upgrades), grant),
		...(upgrades?.windDown.phase === "proposed"
			? [build(cancelWindDownSpec(), grant)]
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
	return [build(acceptSpec(contract, state.handovers.ledger, pending), grant)]
}

export function toGovernanceActions(
	state: GovernanceState,
	grants: Grant[],
	wallet: string,
	inputs: Inputs,
): GovernanceAction[] {
	return GOVERNED_CONTRACTS.flatMap((contract) => {
		const admin = grantFor(grants, CONTRACTS[contract].admin.grant, wallet)
		return [
			...(admin === undefined
				? []
				: adminActions(contract, state, admin, inputs)),
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
	const { windDown } = upgrades
	if (windDown.phase === "proposed" && windDown.activeAt !== null)
		metrics.push({
			label: "Wind-down",
			value: "Proposed",
			note: `Activates ${formatTimestamp(windDown.activeAt)}`,
		})
	return metrics
}

const pendingChangesGroup = (
	contract: TimelockedContract,
	upgrades: Upgrades,
): GovernanceGroup[] => {
	if (upgrades.status !== "ready") return []
	const metrics = pendingChangeMetrics(upgrades.pending)
	const title = `${CONTRACTS[contract].title} pending changes`
	return metrics.length === 0 ? [] : [{ title, metrics }]
}

export const toGovernanceGroups = ({
	holders,
	handovers,
	upgrades,
}: GovernanceState): GovernanceGroup[] => [
	...GOVERNED_CONTRACTS.map((contract) => {
		const { title, admin, roles } = CONTRACTS[contract]
		return {
			title,
			metrics: [
				...[admin, ...roles].map((entry) =>
					holdersMetric(entry.label, holders[entry.holders]),
				),
				...pendingMetric(handovers, contract),
				...(contract === "vault" ? upgradeMetrics(upgrades.vault) : []),
			],
		}
	}),
	...pendingChangesGroup("vault", upgrades.vault),
	...pendingChangesGroup("token", upgrades.token),
]

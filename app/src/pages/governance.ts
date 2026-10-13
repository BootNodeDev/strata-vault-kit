import { StrKey } from "@stellar/stellar-sdk"
import { shortAddress } from "@stellar-scaffold/app-lib"
import { type Metric } from "../components/vault/MetricsStrip"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import { type RoleChange } from "../hooks/useGovernanceTransactions"
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

type RoleContract = "vault" | "oracle" | "token"
type Operation = "grant" | "revoke"

export type GovernanceActionId = `${Operation}-${RoleContract}-role`

export type GovernanceAction = RailAction<RailField> & {
	id: GovernanceActionId
	arg: RoleChange | undefined
	next: string
}

export type GovernanceInputs = Partial<Record<string, string>>

export type GovernanceState = { holders: RoleHolders; vault: string }

export type GovernanceGroup = { title: string; metrics: Metric[] }

type Holder = keyof RoleHolders

type RoleEntry = { role: string; label: string; holders: Holder }

type ContractEntry = {
	title: string
	noun: string
	admin: { grant: string; label: string; holders: Holder }
	roles: [RoleEntry, ...RoleEntry[]]
}

const CONTRACTS: Record<RoleContract, ContractEntry> = {
	vault: {
		title: "Vault",
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

const CONTRACT_ORDER: RoleContract[] = ["vault", "oracle", "token"]

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

type Draft = {
	operation: Operation
	contract: RoleContract
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

function confirmation(
	draft: Draft,
	key: string,
	inputs: GovernanceInputs,
): { field: RailField; condition: Condition } | undefined {
	const label = warningOf(draft)
	if (label === undefined) return undefined
	const value = `${draft.entry.role}:${draft.account}`
	const checked = inputs[key] === value
	return {
		field: { kind: "confirm", key, label, value, checked },
		condition: { label: "Confirmed", met: checked },
	}
}

function roleSpec(
	operation: Operation,
	contract: RoleContract,
	state: GovernanceState,
	inputs: GovernanceInputs,
): Spec<GovernanceActionId, RailField> & {
	arg: RoleChange | undefined
	next: string
} {
	const id: GovernanceActionId = `${operation}-${contract}-role`
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
		{
			key: accountKey,
			label: "Account",
			placeholder: "Address",
			value: text,
			invalid: text.trim() !== "" && account === undefined,
			text: true,
		},
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
			: confirmation(draft, `${id}-confirm`, inputs)
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

export function toGovernanceActions(
	state: GovernanceState,
	grants: Grant[],
	wallet: string,
	inputs: GovernanceInputs,
): GovernanceAction[] {
	const actions: GovernanceAction[] = []
	for (const contract of CONTRACT_ORDER) {
		const grant = grantFor(grants, CONTRACTS[contract].admin.grant, wallet)
		if (grant === undefined) continue
		for (const operation of ["grant", "revoke"] as const) {
			const spec = roleSpec(operation, contract, state, inputs)
			actions.push({
				...toAction(spec, grant, wallet),
				arg: spec.arg,
				next: spec.next,
			})
		}
	}
	return actions
}

const holdersMetric = (label: string, accounts: string[]): Metric =>
	accounts.length === 0
		? { label, value: "0" }
		: {
				label,
				value: String(accounts.length),
				note: holderList(accounts),
			}

export const toGovernanceGroups = ({
	holders,
}: GovernanceState): GovernanceGroup[] =>
	CONTRACT_ORDER.map((contract) => {
		const { title, admin, roles } = CONTRACTS[contract]
		return {
			title,
			metrics: [admin, ...roles].map((entry) =>
				holdersMetric(entry.label, holders[entry.holders]),
			),
		}
	})

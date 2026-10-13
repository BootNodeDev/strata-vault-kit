import { type PendingTransfer } from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import { type GovernedContract } from "../hooks/useGovernanceState"
import { type RailField, readiness } from "./actions"
import { formatTimestamp } from "./cycle"
import {
	type GovernanceAction,
	type GovernanceInputs,
	type GovernanceState,
	toGovernanceActions,
	toGovernanceGroups,
} from "./governance"

const WALLET = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const ACCOUNT = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"
const VAULT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3"
const MANAGER = "GACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAJJHP"

const grantOf = (role: string): Grant => ({
	role,
	authority: WALLET,
	standing: "signs-alone",
})

const governance = grantOf("vault governance")
const oracleAdmin = grantOf("oracle admin")
const tokenAdmin = grantOf("share-token admin")

const holders = (overrides: Partial<RoleHolders> = {}): RoleHolders => ({
	"vault governance": [WALLET],
	"vault manager": [MANAGER],
	"vault treasury": [],
	"vault guardian": [],
	"oracle attester": [],
	"oracle guardian": [],
	"oracle admin": [WALLET],
	"share-token compliance": [],
	"share-token manager": [VAULT],
	"share-token admin": [WALLET],
	"vault pending admin": [],
	"oracle pending admin": [],
	"share-token pending admin": [],
	...overrides,
})

const SEQUENCE = 1_000
const CLOSE_TIME = 1_700_000_000n
const DAY_IN_LEDGERS = 17_280
const DAY = 86_400n

const state = (
	overrides: Partial<RoleHolders> = {},
	pending: Partial<Record<GovernedContract, PendingTransfer>> = {},
	maxLiveUntil: number | null = SEQUENCE + 30 * DAY_IN_LEDGERS,
): GovernanceState => ({
	holders: holders(overrides),
	vault: VAULT,
	handovers: {
		status: "ready",
		ledger: { sequence: SEQUENCE, closeTime: CLOSE_TIME, maxLiveUntil },
		pending: {
			vault: pending.vault ?? null,
			oracle: pending.oracle ?? null,
			token: pending.token ?? null,
		},
	},
})

const find = <Id extends GovernanceAction["id"]>(
	id: Id,
	grants: Grant[],
	inputs: GovernanceInputs = {},
	current: GovernanceState = state(),
) => {
	const action = toGovernanceActions(current, grants, WALLET, inputs).find(
		(candidate) => candidate.id === id,
	)
	if (action === undefined) throw new Error(`no ${id} action`)
	return action as Extract<GovernanceAction, { id: Id }>
}

const fieldOf = (action: GovernanceAction, kind: RailField["kind"]) =>
	action.fields?.find((field) => field.kind === kind)

const condition = (action: GovernanceAction, label: string) =>
	action.conditions.find((candidate) => candidate.label === label)?.met

describe("toGovernanceActions", () => {
	it("offers nothing without an admin grant", () => {
		expect(toGovernanceActions(state(), [], WALLET, {})).toEqual([])
	})

	it.each<[Grant, GovernanceAction["id"][]]>([
		[
			governance,
			["grant-vault-role", "revoke-vault-role", "hand-over-vault-admin"],
		],
		[
			oracleAdmin,
			["grant-oracle-role", "revoke-oracle-role", "hand-over-oracle-admin"],
		],
		[
			tokenAdmin,
			["grant-token-role", "revoke-token-role", "hand-over-token-admin"],
		],
	])(
		"offers %o role changes and the handover on its own contract",
		(grant, ids) => {
			expect(
				toGovernanceActions(state(), [grant], WALLET, {}).map(
					(action) => action.id,
				),
			).toEqual(ids)
		},
	)

	it("lets the admin pick any role of its contract", () => {
		const select = fieldOf(find("grant-oracle-role", [oracleAdmin]), "select")

		expect(select).toEqual({
			kind: "select",
			key: "grant-oracle-role-role",
			label: "Role",
			value: "attester",
			options: [
				{ value: "attester", label: "Attester" },
				{ value: "guardian", label: "Guardian" },
			],
		})
	})

	it("waits for a valid account before enabling", () => {
		const empty = find("grant-oracle-role", [oracleAdmin])
		const invalid = find("grant-oracle-role", [oracleAdmin], {
			"grant-oracle-role-account": "not an address",
		})

		expect(empty.enabled).toBe(false)
		expect(empty.outcome).toBeNull()
		expect(fieldOf(invalid, undefined)).toMatchObject({ invalid: true })
		expect(invalid.enabled).toBe(false)
	})

	it("grants a role the account does not hold and shows the resulting holders", () => {
		const grant = find("grant-oracle-role", [oracleAdmin], {
			"grant-oracle-role-role": "guardian",
			"grant-oracle-role-account": ` ${ACCOUNT} `,
		})

		expect(grant.enabled).toBe(true)
		expect(grant.arg).toEqual({ role: "guardian", account: ACCOUNT })
		expect(grant.next).toBe("Guardian to GABA...EJXA")
		expect(grant.outcome).toBe("Guardian holders: GABA...EJXA")
	})

	it("refuses to grant a role the account already holds", () => {
		const grant = find("grant-vault-role", [governance], {
			"grant-vault-role-account": MANAGER,
		})

		expect(condition(grant, "Account does not hold the role")).toBe(false)
		expect(grant.enabled).toBe(false)
	})

	it("revokes only from a holder and shows who keeps the role", () => {
		const second = holders({ "oracle attester": [MANAGER, ACCOUNT] })
		const revoke = find(
			"revoke-oracle-role",
			[oracleAdmin],
			{ "revoke-oracle-role-account": ACCOUNT },
			{ ...state(), holders: second },
		)
		const notHeld = find("revoke-oracle-role", [oracleAdmin], {
			"revoke-oracle-role-account": ACCOUNT,
		})

		expect(revoke.enabled).toBe(true)
		expect(revoke.next).toBe("Attester from GABA...EJXA")
		expect(revoke.outcome).toBe("Attester holders: GACA...JJHP")
		expect(condition(notHeld, "Account holds the role")).toBe(false)
		expect(notHeld.enabled).toBe(false)
	})

	it("says when revoking leaves a role without holders", () => {
		const revoke = find("revoke-vault-role", [governance], {
			"revoke-vault-role-account": MANAGER,
		})

		expect(revoke.outcome).toBe("Manager holders: none")
		expect(revoke.enabled).toBe(true)
	})

	it("needs a confirmation to revoke the vault's share-token manager role", () => {
		const inputs: GovernanceInputs = {
			"revoke-token-role-role": "manager",
			"revoke-token-role-account": VAULT,
		}
		const unconfirmed = find("revoke-token-role", [tokenAdmin], inputs)
		const confirm = fieldOf(unconfirmed, "confirm")

		expect(confirm).toMatchObject({
			kind: "confirm",
			label: "Stops the vault minting and burning shares.",
			checked: false,
		})
		expect(unconfirmed.tone).toBe("danger")
		expect(unconfirmed.enabled).toBe(false)

		const confirmed = find("revoke-token-role", [tokenAdmin], {
			...inputs,
			[confirm?.key ?? ""]: confirm?.value,
		})
		expect(fieldOf(confirmed, "confirm")).toMatchObject({ checked: true })
		expect(confirmed.enabled).toBe(true)
	})

	it("needs a confirmation to put a second vault role on one account", () => {
		const grant = find("grant-vault-role", [governance], {
			"grant-vault-role-role": "guardian",
			"grant-vault-role-account": MANAGER,
		})
		const toGovernance = find("grant-vault-role", [governance], {
			"grant-vault-role-role": "treasury",
			"grant-vault-role-account": WALLET,
		})
		const separate = find("grant-vault-role", [governance], {
			"grant-vault-role-role": "guardian",
			"grant-vault-role-account": ACCOUNT,
		})

		expect(fieldOf(grant, "confirm")?.label).toBe(
			"Merges two vault roles on one account.",
		)
		expect(grant.enabled).toBe(false)
		expect(fieldOf(toGovernance, "confirm")).toBeDefined()
		expect(fieldOf(separate, "confirm")).toBeUndefined()
		expect(separate.enabled).toBe(true)
	})

	it("drops a confirmation once the role or account changes", () => {
		const inputs: GovernanceInputs = {
			"grant-vault-role-role": "guardian",
			"grant-vault-role-account": MANAGER,
		}
		const confirm = fieldOf(
			find("grant-vault-role", [governance], inputs),
			"confirm",
		)
		const moved = find("grant-vault-role", [governance], {
			...inputs,
			"grant-vault-role-role": "treasury",
			[confirm?.key ?? ""]: confirm?.value,
		})

		expect(fieldOf(moved, "confirm")).toMatchObject({ checked: false })
		expect(moved.enabled).toBe(false)
	})

	it("defers to the grant standing like every admin action", () => {
		const shared: Grant = { ...governance, standing: { needs: 2 } }
		const grant = find("grant-vault-role", [shared], {
			"grant-vault-role-role": "guardian",
			"grant-vault-role-account": ACCOUNT,
		})

		expect(grant.enabled).toBe(false)
		expect(grant.unavailable).toMatch(/Needs 2 signatures/)
	})
})

describe("admin handover", () => {
	const offer = {
		"hand-over-vault-admin-account": ACCOUNT,
		"hand-over-vault-admin-days": "7",
	}
	const transfer = (expired = false): PendingTransfer => ({
		address: WALLET,
		liveUntilLedger: SEQUENCE + DAY_IN_LEDGERS,
		expired,
	})

	it("offers the admin to an account for seven days by default, once confirmed", () => {
		const draft = find("hand-over-vault-admin", [governance], {
			"hand-over-vault-admin-account": ACCOUNT,
		})
		const confirm = fieldOf(draft, "confirm")

		expect(
			draft.fields?.find((field) => field.key === "hand-over-vault-admin-days"),
		).toMatchObject({ value: "7" })
		expect(confirm?.label).toBe("Hands control of the vault to GABA...EJXA.")
		expect(draft.tone).toBe("danger")
		expect(draft.enabled).toBe(false)

		const confirmed = find("hand-over-vault-admin", [governance], {
			...offer,
			[confirm?.key ?? ""]: confirm?.value,
		})
		expect(confirmed.enabled).toBe(true)
		expect(confirmed.arg).toEqual({
			newAdmin: ACCOUNT,
			liveUntilLedger: SEQUENCE + 7 * DAY_IN_LEDGERS,
		})
		expect(confirmed.outcome).toBe(
			`GABA...EJXA becomes admin once it accepts before ${formatTimestamp(
				CLOSE_TIME + 7n * DAY,
			)}.`,
		)
	})

	it("names each contract's handover and holds an empty one as unmet", () => {
		const current = state(
			{},
			{ token: { address: ACCOUNT, liveUntilLedger: 5_000, expired: false } },
		)
		const labels = toGovernanceActions(
			current,
			[governance, oracleAdmin, tokenAdmin],
			WALLET,
			{},
		).map((action) => action.label)
		const empty = find("hand-over-vault-admin", [governance])

		expect(labels).toEqual(
			expect.arrayContaining([
				"Hand over vault admin",
				"Hand over oracle admin",
				"Hand over share-token admin",
				"Cancel the share-token handover",
			]),
		)
		expect(condition(empty, "New admin entered")).toBeNull()
		expect(readiness(empty)).toEqual({ kind: "unmet", count: 1 })
		expect(
			readiness(
				find("hand-over-vault-admin", [governance], {
					"hand-over-vault-admin-account": ACCOUNT,
				}),
			),
		).toEqual({ kind: "unmet", count: 1 })
	})

	it.each<[string, number | null, string, boolean | null]>([
		["0", null, "Expiry ≥ 1 day", false],
		["31", SEQUENCE + 30 * DAY_IN_LEDGERS, "Expiry ≤ 30 days", false],
		["30", SEQUENCE + 30 * DAY_IN_LEDGERS, "Expiry ≤ 30 days", true],
		["1.5", null, "Expiry ≥ 1 day", null],
	])(
		"bounds an expiry of %s days by the network limit %s",
		(days, max, label, met) => {
			const draft = find(
				"hand-over-vault-admin",
				[governance],
				{ ...offer, "hand-over-vault-admin-days": days },
				state({}, {}, max),
			)

			expect(condition(draft, label)).toBe(met)
		},
	)

	it("checks only the lower bound when the network limit is unknown", () => {
		const draft = find(
			"hand-over-vault-admin",
			[governance],
			{ ...offer, "hand-over-vault-admin-days": "400" },
			state({}, {}, null),
		)

		expect(draft.conditions.map(({ label }) => label)).toEqual([
			"New admin entered",
			"Expiry ≥ 1 day",
			"Confirmed",
		])
	})

	it("cancels a pending handover by re-offering it with no expiry", () => {
		const current = state({}, { oracle: { ...transfer(), address: ACCOUNT } })
		const cancel = find("cancel-oracle-handover", [oracleAdmin], {}, current)

		expect(cancel.enabled).toBe(true)
		expect(cancel.arg).toEqual({ newAdmin: ACCOUNT, liveUntilLedger: 0 })
		expect(cancel.outcome).toBe("GABA...EJXA can no longer accept.")
		expect(
			toGovernanceActions(state(), [oracleAdmin], WALLET, {}).map(
				(action) => action.id,
			),
		).not.toContain("cancel-oracle-handover")
	})

	it("lets only the pending wallet accept, while the offer is open", () => {
		const pendingGrant = grantOf("oracle pending admin")
		const accept = find(
			"accept-oracle-admin",
			[pendingGrant],
			{},
			state({}, { oracle: transfer() }),
		)

		expect(accept.enabled).toBe(true)
		expect(accept.outcome).toBe("GAAQ...DZ7H becomes the admin of the oracle.")
		expect(
			toGovernanceActions(
				state({}, { oracle: transfer(true) }),
				[pendingGrant],
				WALLET,
				{},
			),
		).toEqual([])
		expect(
			toGovernanceActions(
				state({}, { oracle: { ...transfer(), address: ACCOUNT } }),
				[pendingGrant],
				WALLET,
				{},
			),
		).toEqual([])
	})
})

describe("toGovernanceGroups", () => {
	it("shows a pending admin with its expiry", () => {
		const groups = toGovernanceGroups(
			state(
				{},
				{
					vault: {
						address: ACCOUNT,
						liveUntilLedger: SEQUENCE + DAY_IN_LEDGERS,
						expired: false,
					},
					token: { address: ACCOUNT, liveUntilLedger: 900, expired: true },
				},
			),
		)

		expect(groups[0]?.metrics.at(-1)).toEqual({
			label: "Pending admin",
			value: "GABA...EJXA",
			note: `Expires ${formatTimestamp(CLOSE_TIME + DAY)}`,
		})
		expect(groups[1]?.metrics.map(({ label }) => label)).not.toContain(
			"Pending admin",
		)
		expect(groups[2]?.metrics.at(-1)?.note).toBe(
			`Expired ${formatTimestamp(CLOSE_TIME - 500n)}`,
		)
	})

	it("lists every role of each contract with its holders", () => {
		const groups = toGovernanceGroups(
			state({ "oracle attester": [MANAGER, ACCOUNT] }),
		)

		expect(groups.map((group) => group.title)).toEqual([
			"Vault",
			"Oracle",
			"Share token",
		])
		expect(groups[1]?.metrics).toEqual([
			{ label: "Admin", value: "1", note: "GAAQ...DZ7H" },
			{ label: "Attester", value: "2", note: "GACA...JJHP, GABA...EJXA" },
			{ label: "Guardian", value: "0" },
		])
		expect(groups[0]?.metrics[0]).toEqual({
			label: "Governance",
			value: "1",
			note: "GAAQ...DZ7H",
		})
		expect(groups[2]?.metrics.map((metric) => metric.label)).toEqual([
			"Admin",
			"Compliance",
			"Manager",
		])
	})
})

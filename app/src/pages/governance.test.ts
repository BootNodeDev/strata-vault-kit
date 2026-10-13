import { describe, expect, it } from "vitest"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import { type RailField } from "./actions"
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
	...overrides,
})

const state = (overrides: Partial<RoleHolders> = {}): GovernanceState => ({
	holders: holders(overrides),
	vault: VAULT,
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
	return action
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
		[governance, ["grant-vault-role", "revoke-vault-role"]],
		[oracleAdmin, ["grant-oracle-role", "revoke-oracle-role"]],
		[tokenAdmin, ["grant-token-role", "revoke-token-role"]],
	])("offers %o grant and revoke on its own contract", (grant, ids) => {
		expect(
			toGovernanceActions(state(), [grant], WALLET, {}).map(
				(action) => action.id,
			),
		).toEqual(ids)
	})

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
			{ holders: second, vault: VAULT },
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

describe("toGovernanceGroups", () => {
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

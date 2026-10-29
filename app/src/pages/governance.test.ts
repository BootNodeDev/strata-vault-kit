import { Buffer } from "buffer"
import { type PendingTransfer } from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { type Metric } from "../components/vault/MetricsStrip"
import { type GovernedContract } from "../hooks/pendingAdmins"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import { type Handovers, type Upgrades } from "../hooks/useGovernanceState"
import { type Inputs, type RailField, readiness } from "./actions"
import { formatDuration, formatTimestamp } from "./cycle"
import {
	type GovernanceAction,
	type GovernanceState,
	toGovernanceActions,
	toGovernanceGroups,
} from "./governance"
import { type PendingChange } from "./pendingChanges"

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
	"identity-verifier admin": [],
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

type ReadyUpgrades = Extract<Upgrades, { status: "ready" }>

const upgradesWindDown: ReadyUpgrades["windDown"] = {
	phase: "none",
	activeAt: null,
	round: null,
	delay: 3n * DAY,
	owed: null,
	supply: null,
}

const upgrades = (overrides: Partial<ReadyUpgrades> = {}): Upgrades => ({
	status: "ready",
	pending: [],
	setupOpen: true,
	delay: 7n * DAY,
	notice: DAY,
	windDown: upgradesWindDown,
	now: CLOSE_TIME,
	paused: "open",
	...overrides,
})

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
	upgrades: { vault: upgrades(), token: upgrades(), oracle: upgrades() },
})

const find = <Id extends GovernanceAction["id"]>(
	id: Id,
	grants: Grant[],
	inputs: Inputs = {},
	current: GovernanceState = state(),
) => {
	const action = toGovernanceActions(current, grants, WALLET, inputs).find(
		(candidate): candidate is Extract<GovernanceAction, { id: Id }> =>
			candidate.id === id,
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
		[
			governance,
			[
				"grant-vault-role",
				"revoke-vault-role",
				"hand-over-vault-admin",
				"propose-code-upgrade",
				"propose-upgrade-delay",
				"propose-wind-down",
			],
		],
		[
			oracleAdmin,
			[
				"grant-oracle-role",
				"revoke-oracle-role",
				"hand-over-oracle-admin",
				"propose-oracle-upgrade",
			],
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
		const inputs: Inputs = {
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
		const inputs: Inputs = {
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

		expect(grant.enabled).toBe(true)
		expect(grant.grant).toBe(shared)
	})
})

describe("admin handover", () => {
	const offer = {
		"hand-over-vault-admin-account": ACCOUNT,
		"hand-over-vault-admin-expiry": "7d",
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
			draft.fields?.find(
				(field) => field.key === "hand-over-vault-admin-expiry",
			),
		).toMatchObject({ value: "7d" })
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

	it("names each contract's handover and holds an empty one as blocked", () => {
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
		expect(readiness(empty)).toEqual({ kind: "blocked" })
		expect(
			readiness(
				find("hand-over-vault-admin", [governance], {
					"hand-over-vault-admin-account": ACCOUNT,
				}),
			),
		).toEqual({ kind: "blocked" })
	})

	it.each<[string, number | null, string, boolean | null]>([
		["59s", null, "Expiry ≥ 1m", false],
		["1m", null, "Expiry ≥ 1m", true],
		["1.5d", null, "Expiry ≥ 1m", null],
		["60", null, "Expiry has a unit, e.g. 7d", false],
		["7d", null, "Expiry has a unit, e.g. 7d", true],
		["31d", SEQUENCE + 30 * DAY_IN_LEDGERS, "Expiry ≤ 30d", false],
		["30d", SEQUENCE + 30 * DAY_IN_LEDGERS, "Expiry ≤ 30d", true],
		["30d 5s", SEQUENCE + 30 * DAY_IN_LEDGERS, "Expiry ≤ 30d", false],
		["1.5d", SEQUENCE + 30 * DAY_IN_LEDGERS, "Expiry ≤ 30d", null],
	])(
		"bounds an expiry of %s by the network limit %s",
		(expiry, max, label, met) => {
			const draft = find(
				"hand-over-vault-admin",
				[governance],
				{ ...offer, "hand-over-vault-admin-expiry": expiry },
				state({}, {}, max),
			)

			expect(condition(draft, label)).toBe(met)
		},
	)

	it("drops a confirmation given for another expiry", () => {
		const draft = find("hand-over-vault-admin", [governance], offer)
		const confirm = fieldOf(draft, "confirm")
		const longer = find("hand-over-vault-admin", [governance], {
			...offer,
			"hand-over-vault-admin-expiry": "8d",
			[confirm?.key ?? ""]: confirm?.value,
		})

		expect(fieldOf(longer, "confirm")).toMatchObject({ checked: false })
		expect(longer.enabled).toBe(false)
	})

	it("offers any expiry the contract accepts, in any duration unit", () => {
		const confirmed = (expiry: string) => {
			const inputs = { ...offer, "hand-over-vault-admin-expiry": expiry }
			const confirm = fieldOf(
				find("hand-over-vault-admin", [governance], inputs),
				"confirm",
			)
			return find("hand-over-vault-admin", [governance], {
				...inputs,
				[confirm?.key ?? ""]: confirm?.value,
			})
		}

		expect(confirmed("36h").arg).toEqual({
			newAdmin: ACCOUNT,
			liveUntilLedger: SEQUENCE + 36 * 720,
		})
		expect(confirmed("1m")).toMatchObject({
			enabled: true,
			arg: { liveUntilLedger: SEQUENCE + 12 },
		})
		expect(confirmed("60")).toMatchObject({ enabled: false, arg: undefined })
	})

	it("refuses an expiry beyond the largest ledger number when the network limit is unknown", () => {
		const draft = find(
			"hand-over-vault-admin",
			[governance],
			{ ...offer, "hand-over-vault-admin-expiry": "99999999d" },
			state({}, {}, null),
		)

		expect(condition(draft, "Expiry within the network limit")).toBe(false)
		expect(draft.arg).toBeUndefined()
		expect(draft.enabled).toBe(false)
	})

	it("checks the largest ledger number alone when the network limit is unknown", () => {
		const draft = find(
			"hand-over-vault-admin",
			[governance],
			{ ...offer, "hand-over-vault-admin-expiry": "400d" },
			state({}, {}, null),
		)

		expect(draft.conditions.map(({ label }) => label)).toEqual([
			"New admin entered",
			"Expiry has a unit, e.g. 7d",
			"Expiry ≥ 1m",
			"Expiry within the network limit",
			"Applies at once",
			"Confirmed",
		])
		expect(condition(draft, "Expiry within the network limit")).toBe(true)
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

	it.each([
		["vault", "vault pending admin"],
		["oracle", "oracle pending admin"],
		["token", "share-token pending admin"],
	] as const)(
		"blocks accepting the %s admin while the vault winds down",
		(contract, role) => {
			const id = `accept-${contract}-admin` as const
			const open = state({}, { [contract]: transfer() })
			const windingDown = (phase: "proposed" | "active"): GovernanceState => {
				const shared = upgrades({ windDown: { ...upgradesWindDown, phase } })
				return {
					...open,
					upgrades: { vault: shared, token: shared, oracle: shared },
				}
			}
			const accept = (current: GovernanceState) =>
				find(id, [grantOf(role)], {}, current)

			expect(condition(accept(open), "Wind-down not active")).toBe(true)
			expect(accept(open).enabled).toBe(true)
			expect(accept(windingDown("proposed")).enabled).toBe(true)
			expect(
				condition(accept(windingDown("active")), "Wind-down not active"),
			).toBe(false)
			expect(accept(windingDown("active")).enabled).toBe(false)
		},
	)
})

describe("vault timelock", () => {
	const HASH = "ab".repeat(32)
	const withUpgrades = (overrides: Partial<ReadyUpgrades>) => ({
		...state(),
		upgrades: {
			vault: upgrades(overrides),
			token: upgrades(),
			oracle: upgrades(),
		},
	})
	const afterSetup = (overrides: Partial<ReadyUpgrades> = {}) =>
		withUpgrades({ setupOpen: false, ...overrides })
	const custodianChange = {
		id: 1,
		change: { tag: "Custodian", values: [ACCOUNT] },
		eta: CLOSE_TIME + DAY,
	}
	const codeChange = {
		id: 2,
		change: { tag: "Upgrade", values: [Buffer.from(HASH, "hex")] },
		eta: CLOSE_TIME + DAY,
	}
	const delayChange = (secs: bigint) => ({
		id: 4,
		change: { tag: "UpgradeDelay", values: [secs] },
		eta: CLOSE_TIME,
	})
	const waits = { label: "Waits for the timelock", met: true, detail: "7d" }
	const ids = (current: GovernanceState, grant = governance) =>
		toGovernanceActions(current, [grant], WALLET, {}).map(({ id }) => id)

	it("grants a vault role through the timelock after setup and at once while setup is open", () => {
		const inputs = {
			"grant-vault-role-role": "treasury",
			"grant-vault-role-account": ACCOUNT,
		}
		const proposed = find(
			"propose-grant-role",
			[governance],
			inputs,
			afterSetup(),
		)
		const direct = find("grant-vault-role", [governance], inputs)

		expect(proposed.label).toBe("Grant a vault role")
		expect(proposed.slot).toBe("grant-vault-role")
		expect(proposed.arg).toEqual({ role: "treasury", account: ACCOUNT })
		expect(proposed.conditions).toContainEqual(waits)
		expect(proposed.enabled).toBe(true)
		expect(direct.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Setup is open",
		})
	})

	it("revokes manager through the timelock after setup and other vault roles at once", () => {
		const revoke = (role: string, holder: string) =>
			toGovernanceActions(
				{ ...afterSetup(), holders: holders({ [`vault ${role}`]: [holder] }) },
				[governance],
				WALLET,
				{
					"revoke-vault-role-role": role,
					"revoke-vault-role-account": holder,
				},
			).find(({ slot }) => slot === "revoke-vault-role")
		const manager = revoke("manager", MANAGER)
		const treasury = revoke("treasury", ACCOUNT)

		expect(manager?.id).toBe("propose-revoke-role")
		expect(manager?.arg).toEqual({ role: "manager", account: MANAGER })
		expect(manager?.conditions).toContainEqual(waits)
		expect(treasury?.id).toBe("revoke-vault-role")
		expect(treasury?.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Revoking this role is instant",
		})
		expect(treasury?.enabled).toBe(true)
	})

	it("keeps the oracle and share-token role changes and hand-overs direct after setup", () => {
		const closed = afterSetup()

		expect(ids(closed, oracleAdmin)).toEqual([
			"grant-oracle-role",
			"revoke-oracle-role",
			"hand-over-oracle-admin",
			"propose-oracle-upgrade",
		])
		expect(ids(closed, tokenAdmin)).toEqual([
			"grant-token-role",
			"revoke-token-role",
			"hand-over-token-admin",
		])
	})

	it("hands the vault admin over through the timelock after setup, once confirmed", () => {
		const inputs = { "hand-over-vault-admin-account": ACCOUNT }
		const draft = find("propose-admin", [governance], inputs, afterSetup())
		const confirm = fieldOf(draft, "confirm")
		const confirmed = find(
			"propose-admin",
			[governance],
			{ ...inputs, [confirm?.key ?? ""]: confirm?.value },
			afterSetup(),
		)

		expect(draft.slot).toBe("hand-over-vault-admin")
		expect(draft.label).toBe("Hand over vault admin")
		expect(draft.fields?.map(({ label }) => label)).toEqual([
			"New admin",
			"Hands control of the vault to GABA...EJXA.",
		])
		expect(draft.enabled).toBe(false)
		expect(confirmed.conditions).toContainEqual(waits)
		expect(confirmed.enabled).toBe(true)
		expect(confirmed.arg).toBe(ACCOUNT)
		expect(confirmed.outcome).toBe(
			"GABA...EJXA can accept the admin once the change applies.",
		)
	})

	it("cancels a pending vault hand-over at once after setup", () => {
		const current = {
			...state(
				{},
				{ vault: { address: ACCOUNT, liveUntilLedger: 5_000, expired: false } },
			),
			upgrades: {
				vault: upgrades({ setupOpen: false }),
				token: upgrades(),
				oracle: upgrades(),
			},
		}

		expect(ids(current)).toContain("cancel-vault-handover")
	})

	it("holds a timelocked vault action while the setup state is unknown", () => {
		const grant = find(
			"grant-vault-role",
			[governance],
			{ "grant-vault-role-account": ACCOUNT },
			withUpgrades({ setupOpen: null }),
		)

		expect(condition(grant, "Setup state read")).toBeNull()
		expect(grant.enabled).toBe(false)
	})

	it("proposes code by its 64-character hash after setup, one code change at a time", () => {
		const input = { "propose-code-upgrade-hash": ` ${HASH.toUpperCase()} ` }
		const short = find(
			"propose-code-upgrade",
			[governance],
			{ "propose-code-upgrade-hash": "abc" },
			afterSetup(),
		)
		const valid = find(
			"propose-code-upgrade",
			[governance],
			input,
			afterSetup(),
		)
		const second = find(
			"propose-code-upgrade",
			[governance],
			input,
			afterSetup({ pending: [delayChange(14n * DAY)] }),
		)
		const duringSetup = find("propose-code-upgrade", [governance], input)

		expect(condition(short, "Hash of 64 hex characters")).toBe(false)
		expect(valid.enabled).toBe(true)
		expect(valid.arg).toBe(HASH)
		expect(valid.next).toBe(`Code ${HASH}`)
		expect(valid.conditions).toContainEqual(waits)
		expect(valid.outcome).toBe(
			`Can apply after ${formatTimestamp(CLOSE_TIME + 7n * DAY)}.`,
		)
		expect(condition(second, "No pending code change")).toBe(false)
		expect(second.enabled).toBe(false)
		expect(condition(duringSetup, "Setup closed")).toBe(false)
		expect(duringSetup.enabled).toBe(false)
	})

	it("refuses a proposal once 16 changes are pending", () => {
		const full = Array.from({ length: 16 }, (_, id) => ({
			...custodianChange,
			id,
		}))
		const grant = find(
			"propose-grant-role",
			[governance],
			{ "grant-vault-role-account": ACCOUNT },
			afterSetup({ pending: full }),
		)

		expect(condition(grant, "Under 16 pending changes")).toBe(false)
		expect(grant.enabled).toBe(false)
	})

	it.each<[string, string, boolean]>([
		["6d", "Delay ≥ 7d", false],
		["91d", "Delay ≤ 90d", false],
		["14d", "Delay ≥ notice 1d", true],
	])("bounds a proposed delay of %s by %s", (text, label, met) => {
		const delay = find(
			"propose-upgrade-delay",
			[governance],
			{ "propose-upgrade-delay-secs": text },
			afterSetup(),
		)

		expect(condition(delay, label)).toBe(met)
	})

	it("lets the current upgrade delay be proposed again", () => {
		const delay = find(
			"propose-upgrade-delay",
			[governance],
			{ "propose-upgrade-delay-secs": "7d" },
			afterSetup(),
		)

		expect(delay.enabled).toBe(true)
		expect(delay.conditions.map(({ label }) => label)).not.toContain(
			"Differs from current",
		)
	})

	it("proposes a new upgrade delay at or above the notice", () => {
		const delay = find(
			"propose-upgrade-delay",
			[governance],
			{ "propose-upgrade-delay-secs": "14d" },
			afterSetup(),
		)
		const belowNotice = find(
			"propose-upgrade-delay",
			[governance],
			{ "propose-upgrade-delay-secs": "8d" },
			afterSetup({ notice: 10n * DAY }),
		)

		expect(delay.enabled).toBe(true)
		expect(delay.arg).toBe(14n * DAY)
		expect(delay.next).toBe("Delay 14d")
		expect(condition(belowNotice, "Delay ≥ notice 10d")).toBe(false)
	})

	it("offers Apply and Cancel for every pending change, by id", () => {
		const actions = toGovernanceActions(
			afterSetup({ pending: [custodianChange, codeChange] }),
			[governance],
			WALLET,
			{},
		)

		expect(
			actions
				.filter(({ id }) => id === "apply-change" || id === "cancel-change")
				.map(({ slot, arg }) => [slot, arg]),
		).toEqual([
			["apply-change-1", 1],
			["cancel-change-1", 1],
			["apply-change-2", 2],
			["cancel-change-2", 2],
		])
		expect(ids(afterSetup())).not.toContain("apply-change")
	})

	it("applies a change after its ETA, unpaused and not winding down", () => {
		const apply = (overrides: Partial<ReadyUpgrades>) =>
			toGovernanceActions(
				afterSetup({ pending: [custodianChange], ...overrides }),
				[governance],
				WALLET,
				{},
			).find(({ id }) => id === "apply-change")!
		const due = { now: CLOSE_TIME + DAY }

		expect(condition(apply({}), "ETA reached")).toBe(false)
		expect(apply(due).enabled).toBe(true)
		expect(apply(due).outcome).toBe("Custodian becomes GABA...EJXA.")
		expect(
			condition(apply({ ...due, paused: "paused" }), "Vault not paused"),
		).toBe(false)
		expect(
			condition(
				apply({
					...due,
					windDown: {
						phase: "active",
						activeAt: CLOSE_TIME,
						round: 0,
						delay: 3n * DAY,
						owed: null,
						supply: null,
					},
				}),
				"Wind-down not active",
			),
		).toBe(false)
	})

	it("re-checks an upgrade delay against the notice when applying", () => {
		const apply = (notice: bigint) =>
			toGovernanceActions(
				afterSetup({ pending: [delayChange(8n * DAY)], notice }),
				[governance],
				WALLET,
				{},
			).find(({ id }) => id === "apply-change")!

		expect(condition(apply(10n * DAY), "Delay ≥ notice 10d")).toBe(false)
		expect(apply(DAY).enabled).toBe(true)
		expect(apply(DAY).outcome).toBe(
			`Upgrade delay becomes ${formatDuration(8n * DAY)}.`,
		)
	})

	it("proposes a wind-down once confirmed, and cancels only a proposed one", () => {
		const draft = find("propose-wind-down", [governance])
		const confirm = fieldOf(draft, "confirm")
		const confirmed = find("propose-wind-down", [governance], {
			[confirm?.key ?? ""]: confirm?.value,
		})
		const windDown = (phase: "proposed" | "active") =>
			withUpgrades({
				windDown: {
					phase,
					activeAt: CLOSE_TIME + DAY,
					round: 0,
					delay: 3n * DAY,
					owed: null,
					supply: null,
				},
			})

		expect(confirm?.label).toBe("Starts closing the vault.")
		expect(draft.enabled).toBe(false)
		expect(confirmed.enabled).toBe(true)
		expect(confirmed.outcome).toBe(
			`Activates ${formatTimestamp(CLOSE_TIME + 3n * DAY)}.`,
		)
		expect(
			condition(
				find("propose-wind-down", [governance], {}, windDown("proposed")),
				"No wind-down proposed",
			),
		).toBe(false)
		expect(
			condition(
				find("propose-wind-down", [governance], {}, windDown("active")),
				"Wind-down not active",
			),
		).toBe(false)
		expect(ids(windDown("proposed"))).toContain("cancel-wind-down")
		expect(ids(windDown("active"))).not.toContain("cancel-wind-down")
		expect(ids(state())).not.toContain("cancel-wind-down")
	})

	it("lists the pending changes in their own group and the proposed wind-down in the vault group", () => {
		const groups = toGovernanceGroups(
			afterSetup({
				pending: [custodianChange],
				windDown: {
					phase: "proposed",
					activeAt: CLOSE_TIME + 2n * DAY,
					round: 0,
					delay: 3n * DAY,
					owed: null,
					supply: null,
				},
			}),
		)

		expect(
			groups.find(({ title }) => title === "Vault pending changes"),
		).toEqual({
			title: "Vault pending changes",
			metrics: [
				{
					label: "#1 Custodian",
					value: "GABA...EJXA",
					title: ACCOUNT,
					note: `ETA ${formatTimestamp(CLOSE_TIME + DAY)}`,
				},
			],
		})
		expect(groups[0]?.metrics.at(-1)).toEqual({
			label: "Wind-down",
			value: "Proposed",
			note: `Activates ${formatTimestamp(CLOSE_TIME + 2n * DAY)}`,
		})
		expect(toGovernanceGroups(state()).map(({ title }) => title)).not.toContain(
			"Vault pending changes",
		)
	})
})

describe("share-token timelock", () => {
	const COMPLIANCE = VAULT
	const tokenUpgrades = (
		token: Partial<ReadyUpgrades>,
		vault: Partial<ReadyUpgrades> = {},
	): GovernanceState => ({
		...state(),
		upgrades: {
			vault: upgrades(vault),
			token: upgrades(token),
			oracle: upgrades(),
		},
	})
	const tokenClosed = (overrides: Partial<ReadyUpgrades> = {}) =>
		tokenUpgrades({ setupOpen: false, ...overrides })
	const complianceChange = {
		id: 1,
		change: { tag: "Compliance", values: [COMPLIANCE] },
		eta: CLOSE_TIME + DAY,
	}
	const waits = { label: "Waits for the timelock", met: true, detail: "7d" }
	const actions = (current: GovernanceState, grant = tokenAdmin) =>
		toGovernanceActions(current, [grant], WALLET, {})

	it("grants a share-token role through the timelock once the token's own setup closes", () => {
		const inputs = {
			"grant-token-role-role": "compliance",
			"grant-token-role-account": ACCOUNT,
		}
		const proposed = find(
			"propose-token-grant-role",
			[tokenAdmin],
			inputs,
			tokenUpgrades({ setupOpen: false }, { setupOpen: true }),
		)
		const direct = find(
			"grant-token-role",
			[tokenAdmin],
			inputs,
			tokenUpgrades({ setupOpen: true }, { setupOpen: false }),
		)

		expect(proposed.slot).toBe("grant-token-role")
		expect(proposed.label).toBe("Grant a share-token role")
		expect(proposed.arg).toEqual({ role: "compliance", account: ACCOUNT })
		expect(proposed.conditions).toContainEqual(waits)
		expect(proposed.enabled).toBe(true)
		expect(direct.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Setup is open",
		})
	})

	it("revokes the token manager through the timelock and compliance at once", () => {
		const revoke = (role: string, holder: string) =>
			toGovernanceActions(
				{
					...tokenClosed(),
					holders: holders({ [`share-token ${role}`]: [holder] }),
				},
				[tokenAdmin],
				WALLET,
				{
					"revoke-token-role-role": role,
					"revoke-token-role-account": holder,
				},
			).find(({ slot }) => slot === "revoke-token-role")
		const manager = revoke("manager", ACCOUNT)
		const compliance = revoke("compliance", ACCOUNT)

		expect(manager?.id).toBe("propose-token-revoke-role")
		expect(manager?.conditions).toContainEqual(waits)
		expect(compliance?.id).toBe("revoke-token-role")
		expect(compliance?.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Revoking this role is instant",
		})
	})

	it("hands the token admin over through the timelock, once confirmed, and cancels an offer at once", () => {
		const inputs = { "hand-over-token-admin-account": ACCOUNT }
		const draft = find(
			"propose-token-admin",
			[tokenAdmin],
			inputs,
			tokenClosed(),
		)
		const confirm = fieldOf(draft, "confirm")
		const confirmed = find(
			"propose-token-admin",
			[tokenAdmin],
			{ ...inputs, [confirm?.key ?? ""]: confirm?.value },
			tokenClosed(),
		)
		const offered = {
			...state(
				{},
				{ token: { address: ACCOUNT, liveUntilLedger: 5_000, expired: false } },
			),
			upgrades: tokenClosed().upgrades,
		}

		expect(draft.slot).toBe("hand-over-token-admin")
		expect(draft.label).toBe("Hand over share-token admin")
		expect(confirm?.label).toBe(
			"Hands control of the share token to GABA...EJXA.",
		)
		expect(draft.enabled).toBe(false)
		expect(confirmed.conditions).toContainEqual(waits)
		expect(confirmed.enabled).toBe(true)
		expect(confirmed.arg).toBe(ACCOUNT)
		expect(actions(offered).map(({ id }) => id)).toContain(
			"cancel-token-handover",
		)
	})

	it("holds a timelocked token action while the token's setup state is unknown", () => {
		const grant = find(
			"grant-token-role",
			[tokenAdmin],
			{ "grant-token-role-account": ACCOUNT },
			tokenUpgrades({ setupOpen: null }),
		)

		expect(condition(grant, "Setup state read")).toBeNull()
		expect(grant.enabled).toBe(false)
	})

	it("counts the token's own queue against the 16-change limit", () => {
		const full = Array.from({ length: 16 }, (_, id) => ({
			...complianceChange,
			id,
		}))
		const grant = (current: GovernanceState) =>
			find(
				"propose-token-grant-role",
				[tokenAdmin],
				{ "grant-token-role-account": ACCOUNT },
				current,
			)

		expect(
			condition(
				grant(tokenClosed({ pending: full })),
				"Under 16 pending changes",
			),
		).toBe(false)
		expect(
			condition(
				grant(tokenUpgrades({ setupOpen: false }, { pending: full })),
				"Under 16 pending changes",
			),
		).toBe(true)
	})

	it("offers Apply and Cancel for every pending token change under the token's ids", () => {
		const current = tokenUpgrades(
			{ setupOpen: false, pending: [complianceChange] },
			{
				setupOpen: false,
				pending: [
					{ ...complianceChange, change: { tag: "Notice", values: [DAY] } },
				],
			},
		)

		expect(
			actions(current)
				.filter(({ id }) => id.endsWith("token-change"))
				.map(({ id, slot, arg }) => [id, slot, arg]),
		).toEqual([
			["apply-token-change", "apply-token-change-1", 1],
			["cancel-token-change", "cancel-token-change-1", 1],
		])
		expect(actions(current, governance).map(({ id }) => id)).not.toContain(
			"apply-token-change",
		)
	})

	it("applies a token change after its ETA while the vault is unpaused and not winding down", () => {
		const apply = (overrides: Partial<ReadyUpgrades>) =>
			actions(tokenClosed({ pending: [complianceChange], ...overrides })).find(
				({ id }) => id === "apply-token-change",
			)!
		const due = { now: CLOSE_TIME + DAY }

		expect(condition(apply({}), "ETA reached")).toBe(false)
		expect(apply(due).enabled).toBe(true)
		expect(apply(due).outcome).toBe("Compliance contract becomes CABQ...GCK3.")
		expect(apply(due).next).toBe(
			"share token change #1: Compliance contract CABQ...GCK3",
		)
		expect(apply(due).conditions.map(({ label }) => label)).toEqual([
			"ETA reached",
			"Vault not paused",
			"Wind-down not active",
		])
		expect(
			condition(apply({ ...due, paused: "paused" }), "Vault not paused"),
		).toBe(false)
	})

	it("lists the share token's pending changes in their own group", () => {
		const groups = toGovernanceGroups(
			tokenClosed({ pending: [complianceChange] }),
		)

		expect(
			groups.find(({ title }) => title === "Share token pending changes"),
		).toEqual({
			title: "Share token pending changes",
			metrics: [
				{
					label: "#1 Compliance contract",
					value: "CABQ...GCK3",
					title: COMPLIANCE,
					note: `ETA ${formatTimestamp(CLOSE_TIME + DAY)}`,
				},
			],
		})
		expect(groups.map(({ title }) => title)).not.toContain(
			"Vault pending changes",
		)
	})
})

describe("oracle timelock", () => {
	const HASH = "cd".repeat(32)
	const oracleUpgrades = (
		oracle: Partial<ReadyUpgrades>,
		vault: Partial<ReadyUpgrades> = {},
	): GovernanceState => ({
		...state(),
		upgrades: {
			vault: upgrades(vault),
			token: upgrades(),
			oracle: upgrades(oracle),
		},
	})
	const oracleClosed = (overrides: Partial<ReadyUpgrades> = {}) =>
		oracleUpgrades({ setupOpen: false, ...overrides })
	const adminChange = {
		id: 3,
		change: { tag: "Admin", values: [ACCOUNT] },
		eta: CLOSE_TIME + DAY,
	}
	const configChange = {
		id: 4,
		change: {
			tag: "Config",
			values: [
				{
					freshness_duration: DAY,
					cooldown_secs: 3_600n,
					max_up_bps: 1_000,
					max_down_bps: 500,
					min_answer: 900_000_000_000_000_000n,
					max_answer: 1_100_000_000_000_000_000n,
				},
			],
		},
		eta: CLOSE_TIME + DAY,
	}
	const upgradeChange = {
		id: 5,
		change: { tag: "Upgrade", values: [Buffer.from(HASH, "hex")] },
		eta: CLOSE_TIME + DAY,
	}
	const waits = { label: "Waits for the timelock", met: true, detail: "7d" }
	const actions = (current: GovernanceState, grant = oracleAdmin) =>
		toGovernanceActions(current, [grant], WALLET, {})

	it("grants an oracle role through the timelock once the oracle's own setup closes", () => {
		const inputs = {
			"grant-oracle-role-role": "attester",
			"grant-oracle-role-account": ACCOUNT,
		}
		const proposed = find(
			"propose-oracle-grant-role",
			[oracleAdmin],
			inputs,
			oracleUpgrades({ setupOpen: false }, { setupOpen: true }),
		)
		const direct = find(
			"grant-oracle-role",
			[oracleAdmin],
			inputs,
			oracleUpgrades({ setupOpen: true }, { setupOpen: false }),
		)

		expect(proposed.slot).toBe("grant-oracle-role")
		expect(proposed.label).toBe("Grant an oracle role")
		expect(proposed.arg).toEqual({ role: "attester", account: ACCOUNT })
		expect(proposed.conditions).toContainEqual(waits)
		expect(proposed.enabled).toBe(true)
		expect(direct.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Setup is open",
		})
	})

	it("revokes every oracle role at once after setup", () => {
		const revoke = (role: string) =>
			toGovernanceActions(
				{
					...oracleClosed(),
					holders: holders({ [`oracle ${role}`]: [ACCOUNT] }),
				},
				[oracleAdmin],
				WALLET,
				{
					"revoke-oracle-role-role": role,
					"revoke-oracle-role-account": ACCOUNT,
				},
			).find(({ slot }) => slot === "revoke-oracle-role")

		for (const role of ["attester", "guardian"]) {
			expect(revoke(role)?.id).toBe("revoke-oracle-role")
			expect(revoke(role)?.conditions).toContainEqual({
				label: "Applies at once",
				met: true,
				detail: "Revoking this role is instant",
			})
			expect(revoke(role)?.enabled).toBe(true)
		}
	})

	it("hands the oracle admin over through the timelock, once confirmed, and cancels an offer at once", () => {
		const inputs = { "hand-over-oracle-admin-account": ACCOUNT }
		const draft = find(
			"propose-oracle-admin",
			[oracleAdmin],
			inputs,
			oracleClosed(),
		)
		const confirm = fieldOf(draft, "confirm")
		const confirmed = find(
			"propose-oracle-admin",
			[oracleAdmin],
			{ ...inputs, [confirm?.key ?? ""]: confirm?.value },
			oracleClosed(),
		)
		const offered = {
			...state(
				{},
				{
					oracle: { address: ACCOUNT, liveUntilLedger: 5_000, expired: false },
				},
			),
			upgrades: oracleClosed().upgrades,
		}

		expect(draft.slot).toBe("hand-over-oracle-admin")
		expect(draft.label).toBe("Hand over oracle admin")
		expect(confirm?.label).toBe("Hands control of the oracle to GABA...EJXA.")
		expect(draft.enabled).toBe(false)
		expect(confirmed.conditions).toContainEqual(waits)
		expect(confirmed.enabled).toBe(true)
		expect(confirmed.arg).toBe(ACCOUNT)
		expect(actions(offered).map(({ id }) => id)).toContain(
			"cancel-oracle-handover",
		)
	})

	it("holds a timelocked oracle action while the oracle's setup state is unknown", () => {
		const grant = find(
			"grant-oracle-role",
			[oracleAdmin],
			{ "grant-oracle-role-account": ACCOUNT },
			oracleUpgrades({ setupOpen: null }),
		)

		expect(condition(grant, "Setup state read")).toBeNull()
		expect(grant.enabled).toBe(false)
	})

	it("offers the oracle code upgrade only as a proposed change after setup, one at a time", () => {
		const input = { "propose-oracle-upgrade-hash": HASH }
		const open = find("propose-oracle-upgrade", [oracleAdmin], input)
		const closed = find(
			"propose-oracle-upgrade",
			[oracleAdmin],
			input,
			oracleClosed(),
		)
		const busy = find(
			"propose-oracle-upgrade",
			[oracleAdmin],
			input,
			oracleClosed({ pending: [upgradeChange] }),
		)

		expect(open.label).toBe("Propose an oracle code upgrade")
		expect(condition(open, "Setup closed")).toBe(false)
		expect(open.enabled).toBe(false)
		expect(closed.enabled).toBe(true)
		expect(closed.arg).toBe(HASH)
		expect(closed.conditions).toContainEqual(waits)
		expect(condition(busy, "No pending code change")).toBe(false)
		expect(
			find("propose-code-upgrade", [governance], {}, oracleClosed()).label,
		).toBe("Propose a code upgrade")
	})

	it("offers Apply and Cancel for every pending oracle change under the oracle's ids", () => {
		const current = oracleClosed({ pending: [adminChange] })

		expect(
			actions(current)
				.filter(({ id }) => id.endsWith("oracle-change"))
				.map(({ id, slot, arg }) => [id, slot, arg]),
		).toEqual([
			["apply-oracle-change", "apply-oracle-change-3", 3],
			["cancel-oracle-change", "cancel-oracle-change-3", 3],
		])
		expect(actions(current, governance).map(({ id }) => id)).not.toContain(
			"apply-oracle-change",
		)
	})

	it("applies an oracle change after its ETA while the vault is unpaused and not winding down", () => {
		const apply = (
			overrides: Partial<ReadyUpgrades>,
			change: PendingChange = adminChange,
		) =>
			actions(oracleClosed({ pending: [change], ...overrides })).find(
				({ id }) => id === "apply-oracle-change",
			)!
		const due = { now: CLOSE_TIME + DAY }

		expect(condition(apply({}), "ETA reached")).toBe(false)
		expect(apply(due).enabled).toBe(true)
		expect(apply(due).outcome).toBe("Offers the admin to GABA...EJXA.")
		expect(apply(due).conditions.map(({ label }) => label)).toEqual([
			"ETA reached",
			"Vault not paused",
			"Wind-down not active",
		])
		expect(
			condition(apply({ ...due, paused: "paused" }), "Vault not paused"),
		).toBe(false)
		expect(
			condition(
				apply({ ...due, windDown: { ...upgradesWindDown, phase: "active" } }),
				"Wind-down not active",
			),
		).toBe(false)
		expect(apply(due, upgradeChange).tone).toBe("danger")
		expect(fieldOf(apply(due, upgradeChange), "confirm")?.label).toBe(
			`Replaces the oracle's code with ${HASH}.`,
		)
	})

	it("lists the oracle's pending changes in their own group, limits included", () => {
		const groups = toGovernanceGroups(oracleClosed({ pending: [configChange] }))

		expect(
			groups.find(({ title }) => title === "Oracle pending changes")?.metrics,
		).toEqual([
			{
				label: "#4 Oracle limits",
				value:
					"freshness window 1d, cooldown 1h, largest rise 10%, largest fall 5%, price floor 0.9000, price ceiling 1.1000",
				note: `ETA ${formatTimestamp(CLOSE_TIME + DAY)}`,
			},
		])
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

	it.each<[Handovers, Metric[]]>([
		[{ status: "checking" }, []],
		[
			{ status: "unreadable" },
			[{ label: "Pending admin", value: null, note: "Could not be read" }],
		],
	])("shows the pending admin of a %o read", (handovers, metrics) => {
		const groups = toGovernanceGroups({ ...state(), handovers })

		for (const group of groups)
			expect(
				group.metrics.filter(({ label }) => label === "Pending admin"),
			).toEqual(metrics)
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

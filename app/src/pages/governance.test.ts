import { type PendingTransfer } from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { type Metric } from "../components/vault/MetricsStrip"
import { type GovernedContract } from "../hooks/pendingAdmins"
import { type Grant, type RoleHolders } from "../hooks/useAdminAuthority"
import { type Handovers, type Upgrades } from "../hooks/useGovernanceState"
import { type RailField, readiness } from "./actions"
import { formatDuration, formatTimestamp } from "./cycle"
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

type ReadyUpgrades = Extract<Upgrades, { status: "ready" }>

const upgrades = (overrides: Partial<ReadyUpgrades> = {}): Upgrades => ({
	status: "ready",
	proposal: null,
	delay: 7n * DAY,
	notice: DAY,
	windDown: {
		phase: "none",
		activeAt: null,
		round: null,
		delay: 3n * DAY,
		owed: null,
		supply: null,
	},
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
	upgrades: upgrades(),
})

const find = <Id extends GovernanceAction["id"]>(
	id: Id,
	grants: Grant[],
	inputs: GovernanceInputs = {},
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
		["4s", null, "Expiry ≥ 5s", false],
		["5s", null, "Expiry ≥ 5s", true],
		["1.5d", null, "Expiry ≥ 5s", null],
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
		expect(confirmed("5s")).toMatchObject({
			enabled: true,
			arg: { liveUntilLedger: SEQUENCE + 1 },
		})
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
			"Expiry ≥ 5s",
			"Expiry within the network limit",
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
})

describe("upgrades and wind-down", () => {
	const HASH = "ab".repeat(32)
	const withUpgrades = (overrides: Partial<ReadyUpgrades>) => ({
		...state(),
		upgrades: upgrades(overrides),
	})
	const codeProposal = {
		kind: "code" as const,
		hash: HASH,
		eta: CLOSE_TIME + DAY,
	}

	it("proposes code by its 64-character hash while nothing is pending", () => {
		const short = find("propose-code-upgrade", [governance], {
			"propose-code-upgrade-hash": "abc",
		})
		const valid = find("propose-code-upgrade", [governance], {
			"propose-code-upgrade-hash": ` ${HASH.toUpperCase()} `,
		})
		const blocked = find(
			"propose-code-upgrade",
			[governance],
			{ "propose-code-upgrade-hash": HASH },
			withUpgrades({ proposal: codeProposal }),
		)

		expect(condition(short, "Hash of 64 hex characters")).toBe(false)
		expect(valid.enabled).toBe(true)
		expect(valid.arg).toBe(HASH)
		expect(valid.next).toBe(`Code ${HASH}`)
		expect(valid.outcome).toBe(
			`Can apply after ${formatTimestamp(CLOSE_TIME + 7n * DAY)}.`,
		)
		expect(condition(blocked, "No pending upgrade")).toBe(false)
		expect(blocked.enabled).toBe(false)
	})

	it.each<[string, string, boolean]>([
		["6d", "Delay ≥ 7d", false],
		["91d", "Delay ≤ 90d", false],
		["14d", "Delay ≥ notice 1d", true],
	])("bounds a proposed delay of %s by %s", (text, label, met) => {
		const delay = find("propose-upgrade-delay", [governance], {
			"propose-upgrade-delay-secs": text,
		})

		expect(condition(delay, label)).toBe(met)
	})

	it("lets the current upgrade delay be proposed again", () => {
		const delay = find("propose-upgrade-delay", [governance], {
			"propose-upgrade-delay-secs": "7d",
		})

		expect(delay.enabled).toBe(true)
		expect(delay.conditions.map(({ label }) => label)).not.toContain(
			"Differs from current",
		)
	})

	it("proposes a new upgrade delay at or above the notice", () => {
		const delay = find("propose-upgrade-delay", [governance], {
			"propose-upgrade-delay-secs": "14d",
		})
		const belowNotice = find(
			"propose-upgrade-delay",
			[governance],
			{ "propose-upgrade-delay-secs": "8d" },
			withUpgrades({ notice: 10n * DAY }),
		)

		expect(delay.enabled).toBe(true)
		expect(delay.arg).toBe(14n * DAY)
		expect(delay.next).toBe("Delay 14d")
		expect(condition(belowNotice, "Delay ≥ notice 10d")).toBe(false)
	})

	it("applies a code upgrade after its ETA, unpaused and confirmed", () => {
		const early = find(
			"apply-upgrade",
			[governance],
			{},
			withUpgrades({
				proposal: codeProposal,
			}),
		)
		const due = withUpgrades({ proposal: codeProposal, now: CLOSE_TIME + DAY })
		const unconfirmed = find("apply-upgrade", [governance], {}, due)
		const confirm = fieldOf(unconfirmed, "confirm")
		const confirmed = find(
			"apply-upgrade",
			[governance],
			{ [confirm?.key ?? ""]: confirm?.value },
			due,
		)
		const paused = find(
			"apply-upgrade",
			[governance],
			{ [confirm?.key ?? ""]: confirm?.value },
			withUpgrades({
				proposal: codeProposal,
				now: CLOSE_TIME + DAY,
				paused: "paused",
			}),
		)

		expect(condition(early, "ETA reached")).toBe(false)
		expect(confirm?.label).toBe(`Replaces the vault's code with ${HASH}.`)
		expect(unconfirmed.tone).toBe("danger")
		expect(unconfirmed.enabled).toBe(false)
		expect(confirmed.enabled).toBe(true)
		expect(confirmed.next).toBe(`Code ${HASH}`)
		expect(condition(paused, "Vault not paused")).toBe(false)
	})

	it("re-checks a delay proposal against the notice when applying", () => {
		const proposal = { kind: "delay" as const, secs: 8n * DAY, eta: CLOSE_TIME }
		const apply = find(
			"apply-upgrade",
			[governance],
			{},
			withUpgrades({ proposal, notice: 10n * DAY }),
		)
		const fine = find(
			"apply-upgrade",
			[governance],
			{},
			withUpgrades({ proposal }),
		)

		expect(condition(apply, "Delay ≥ notice 10d")).toBe(false)
		expect(fine.fields).toEqual([])
		expect(fine.enabled).toBe(true)
		expect(fine.outcome).toBe(
			`Upgrade delay becomes ${formatDuration(8n * DAY)}.`,
		)
	})

	it("offers apply and cancel only while an upgrade is pending", () => {
		const ids = (current: GovernanceState) =>
			toGovernanceActions(current, [governance], WALLET, {}).map(
				(action) => action.id,
			)

		expect(ids(state())).not.toContain("apply-upgrade")
		expect(ids(state())).not.toContain("cancel-upgrade")
		expect(ids(withUpgrades({ proposal: codeProposal }))).toEqual(
			expect.arrayContaining(["apply-upgrade", "cancel-upgrade"]),
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
		const ids = (current: GovernanceState) =>
			toGovernanceActions(current, [governance], WALLET, {}).map(
				(action) => action.id,
			)

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

	it("keeps a pending code upgrade short in its tile but exposes the full hash", () => {
		const [vault] = toGovernanceGroups(withUpgrades({ proposal: codeProposal }))

		expect(
			vault?.metrics.find(({ label }) => label === "Pending upgrade"),
		).toEqual({
			label: "Pending upgrade",
			value: "Code abab...abab",
			title: `Code ${HASH}`,
			note: `ETA ${formatTimestamp(CLOSE_TIME + DAY)}`,
		})
	})

	it("shows the pending upgrade and the proposed wind-down in the vault group", () => {
		const [vault] = toGovernanceGroups(
			withUpgrades({
				proposal: { kind: "delay", secs: 14n * DAY, eta: CLOSE_TIME + DAY },
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

		expect(vault?.metrics.slice(-2)).toEqual([
			{
				label: "Pending upgrade",
				value: "Delay 14d",
				note: `ETA ${formatTimestamp(CLOSE_TIME + DAY)}`,
			},
			{
				label: "Wind-down",
				value: "Proposed",
				note: `Activates ${formatTimestamp(CLOSE_TIME + 2n * DAY)}`,
			},
		])
		expect(
			toGovernanceGroups(state())[0]?.metrics.map(({ label }) => label),
		).not.toContain("Pending upgrade")
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

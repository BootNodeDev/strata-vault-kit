import { type Amount } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { type Grant } from "../hooks/useAdminAuthority"
import { type TargetReads } from "../hooks/useComplianceState"
import {
	type ComplianceAction,
	type ComplianceState,
	toComplianceActions,
	toComplianceTiles,
} from "./compliance"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<object>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
}))

const WALLET = "GWALLETADDRESS1234"
const HOLDER = "GDPO5SQDJY4E2XEE47MAOT2M2F3GR4H2AYYKSMIOT2YPOHAMC36VKWIA"
const VAULT = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR"
const DESTINATION = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3"
const VERIFIER = "CVERIFIERADDRESS"
const UNIT = 10_000_000n

const grantOf = (role: string): Grant => ({
	role,
	authority: WALLET,
	standing: "signs-alone",
})

const verifierAdmin = grantOf("identity-verifier admin")
const officer = grantOf("share-token compliance")

const reads = (overrides: Partial<TargetReads> = {}): TargetReads => ({
	allowance: "allowed",
	frozen: false,
	shares: (100n * UNIT) as Amount,
	frozenShares: (10n * UNIT) as Amount,
	...overrides,
})

const stateOf = (
	target: string | undefined,
	overrides: Partial<TargetReads> = {},
	destination: ComplianceState["destination"] = "allowed",
): ComplianceState => ({
	verifier: VERIFIER,
	target,
	reads:
		target === undefined
			? { status: "none" }
			: { status: "ready", reads: reads(overrides) },
	vault: VAULT,
	destination,
	adminUnknown: false,
})

const actionOf = (
	state: ComplianceState,
	id: ComplianceAction["id"],
	inputs: Record<string, string> = {},
	grants = [verifierAdmin, officer],
): ComplianceAction => {
	const action = toComplianceActions(state, grants, WALLET, inputs).find(
		(candidate) => candidate.id === id,
	)
	if (action === undefined) throw new Error(`no ${id} action`)
	return action
}

const unmet = (action: ComplianceAction) =>
	action.conditions
		.filter((condition) => condition.met !== true)
		.map(({ label, met }) => [label, met])

describe("toComplianceActions", () => {
	it("offers the allowlist only to the verifier admin and the freezes only to the compliance role", () => {
		const ids = (grants: Grant[]) =>
			toComplianceActions(stateOf(HOLDER), grants, WALLET, {}).map(
				(action) => action.id,
			)

		expect(ids([verifierAdmin])).toEqual(["allow-address", "disallow-address"])
		expect(ids([officer])).toEqual([
			"freeze-address",
			"unfreeze-address",
			"freeze-shares",
			"unfreeze-shares",
			"force-transfer",
		])
		expect(ids([grantOf("share-token admin")])).toEqual([])
	})

	it("withholds the allowlist from the compliance role when the verifier admin cannot be read", () => {
		const actions = toComplianceActions(
			{ ...stateOf(HOLDER), adminUnknown: true },
			[officer],
			WALLET,
			{},
		)

		expect(
			actions
				.filter(({ id }) => id.endsWith("allow-address"))
				.map(({ id, label, enabled, unavailable }) => [
					id,
					label,
					enabled,
					unavailable,
				]),
		).toEqual([
			[
				"allow-address",
				"Allow the address",
				false,
				"Could not read the allowlist admin.",
			],
			[
				"disallow-address",
				"Remove from the allowlist",
				false,
				"Could not read the allowlist admin.",
			],
		])
	})

	it("does not withhold the allowlist from a verifier admin or offer it to a wallet with no surface", () => {
		const state = { ...stateOf(HOLDER), adminUnknown: true }

		expect(
			toComplianceActions(state, [verifierAdmin], WALLET, {})
				.filter(({ id }) => id.endsWith("allow-address"))
				.map(({ unavailable }) => unavailable),
		).toEqual([undefined, undefined])
		expect(toComplianceActions(state, [], WALLET, {})).toEqual([])
	})

	it("blocks every action until a target address is entered", () => {
		const actions = toComplianceActions(
			stateOf(undefined),
			[verifierAdmin, officer],
			WALLET,
			{},
		)

		for (const action of actions) {
			expect(action.enabled).toBe(false)
			expect(action.conditions[0]).toEqual({
				label: "Target address entered",
				met: null,
			})
		}
	})

	it("allows a target that is not allowlisted, showing the resulting state", () => {
		const action = actionOf(
			stateOf(HOLDER, { allowance: "not-allowed" }),
			"allow-address",
		)

		expect(action.enabled).toBe(true)
		expect(action.outcome).toBe("Allowlisted No → Yes.")
		expect(action.arg).toEqual({ verifier: VERIFIER, account: HOLDER })
	})

	it("reads an already-allowlisted target as no change", () => {
		const action = actionOf(stateOf(HOLDER), "allow-address")

		expect(action.enabled).toBe(false)
		expect(action.outcome).toBeNull()
		expect(unmet(action)).toEqual([["Not allowlisted", false]])
	})

	it("holds nothing back while the target state is unknown", () => {
		const action = actionOf(
			stateOf(HOLDER, { allowance: "unreadable", frozen: null }),
			"freeze-address",
		)

		expect(action.enabled).toBe(true)
		expect(action.outcome).toBeNull()
	})

	it("freezes and unfreezes the address on its current state", () => {
		expect(actionOf(stateOf(HOLDER), "freeze-address").outcome).toBe(
			"Frozen No → Yes.",
		)
		expect(actionOf(stateOf(HOLDER), "unfreeze-address").enabled).toBe(false)
		expect(
			actionOf(stateOf(HOLDER, { frozen: true }), "unfreeze-address").outcome,
		).toBe("Frozen Yes → No.")
	})

	it.each<[ComplianceAction["id"], string]>([
		["disallow-address", "Stops the vault returning shares on cancellations."],
		["freeze-address", "Stops the vault moving shares."],
	])("asks to confirm %s on the vault", (id, label) => {
		const state = stateOf(VAULT, { frozen: false, allowance: "allowed" })
		const unconfirmed = actionOf(state, id)

		expect(unconfirmed.enabled).toBe(false)
		expect(unconfirmed.tone).toBe("danger")
		expect(unconfirmed.fields).toEqual([
			{
				kind: "confirm",
				key: `${id}-confirm`,
				label,
				value: VAULT,
				checked: false,
			},
		])
		expect(actionOf(state, id, { [`${id}-confirm`]: VAULT }).enabled).toBe(true)
	})

	it("needs no confirmation for another address", () => {
		const action = actionOf(stateOf(HOLDER), "disallow-address")

		expect(action.fields).toBeUndefined()
		expect(action.tone).toBeUndefined()
		expect(action.enabled).toBe(true)
	})

	it("freezes an exact amount of free shares", () => {
		const action = actionOf(stateOf(HOLDER), "freeze-shares", {
			"freeze-shares-amount": "5.1234567",
		})

		expect(action.enabled).toBe(true)
		expect(action.outcome).toBe("Frozen shares 10.00 → 15.1234567.")
		expect(action.arg).toEqual({ account: HOLDER, amount: 51_234_567n })
		expect(action.conditions[2]).toEqual({
			label: "Amount ≤ free shares",
			met: true,
			detail: "90.00",
		})
		expect(action.fields?.[0]).toMatchObject({ max: "90.00", invalid: false })
	})

	it("refuses to freeze more than the free shares", () => {
		const action = actionOf(stateOf(HOLDER), "freeze-shares", {
			"freeze-shares-amount": "90.0000001",
		})

		expect(action.enabled).toBe(false)
		expect(action.outcome).toBeNull()
		expect(unmet(action)).toEqual([["Amount ≤ free shares", false]])
	})

	it.each(["0", "-1", "abc"])("blocks the amount %j", (text) => {
		const action = actionOf(stateOf(HOLDER), "freeze-shares", {
			"freeze-shares-amount": text,
		})

		expect(action.enabled).toBe(false)
		expect(action.arg).toBeUndefined()
	})

	it("unfreezes at most the frozen shares", () => {
		const within = actionOf(stateOf(HOLDER), "unfreeze-shares", {
			"unfreeze-shares-amount": "10",
		})
		const over = actionOf(stateOf(HOLDER), "unfreeze-shares", {
			"unfreeze-shares-amount": "10.0000001",
		})

		expect(within.outcome).toBe("Frozen shares 10.00 → 0.00.")
		expect(over.enabled).toBe(false)
		expect(unmet(over)).toEqual([["Amount ≤ frozen shares", false]])
	})

	it("asks to confirm freezing the vault's shares, tied to the amount", () => {
		const inputs = { "freeze-shares-amount": "5" }
		const state = stateOf(VAULT)

		expect(actionOf(state, "freeze-shares", inputs).enabled).toBe(false)
		expect(
			actionOf(state, "freeze-shares", {
				...inputs,
				"freeze-shares-confirm": `${VAULT}:5`,
			}).enabled,
		).toBe(true)
		expect(
			actionOf(state, "freeze-shares", {
				"freeze-shares-amount": "6",
				"freeze-shares-confirm": `${VAULT}:5`,
			}).enabled,
		).toBe(false)
	})

	it("forces a transfer within the balance, unfreezing the shortfall", () => {
		const inputs = {
			"force-transfer-destination": DESTINATION,
			"force-transfer-amount": "95",
		}
		const action = actionOf(stateOf(HOLDER), "force-transfer", inputs)

		expect(action.enabled).toBe(true)
		expect(action.outcome).toBe(
			"Shares 100.00 → 5.00. Frozen shares 10.00 → 5.00.",
		)
		expect(action.arg).toEqual({
			from: HOLDER,
			to: DESTINATION,
			amount: 95n * UNIT,
		})
		expect(action.note).toBeUndefined()
	})

	it("refuses a transfer above the balance and waits for a destination", () => {
		const over = actionOf(stateOf(HOLDER), "force-transfer", {
			"force-transfer-destination": DESTINATION,
			"force-transfer-amount": "100.0000001",
		})
		const missing = actionOf(stateOf(HOLDER), "force-transfer", {
			"force-transfer-amount": "1",
		})

		expect(unmet(over)).toEqual([["Amount ≤ shares", false]])
		expect(over.enabled).toBe(false)
		expect(unmet(missing)).toEqual([
			["Destination entered", null],
			["Destination differs from the address", null],
		])
		expect(missing.enabled).toBe(false)
	})

	it("refuses a destination equal to the target and shows no outcome", () => {
		const action = actionOf(stateOf(HOLDER), "force-transfer", {
			"force-transfer-destination": HOLDER,
			"force-transfer-amount": "5",
		})

		expect(unmet(action)).toEqual([
			["Destination differs from the address", false],
		])
		expect(action.enabled).toBe(false)
		expect(action.outcome).toBeNull()
		expect(action.arg).toBeUndefined()
	})

	it("notes a destination that is not allowlisted", () => {
		const action = actionOf(
			stateOf(HOLDER, {}, "not-allowed"),
			"force-transfer",
			{
				"force-transfer-destination": DESTINATION,
				"force-transfer-amount": "1",
			},
		)

		expect(action.enabled).toBe(true)
		expect(action.note).toBe(
			"The destination is not allowlisted and cannot move them.",
		)
	})

	it("asks to confirm a transfer out of the vault", () => {
		const action = actionOf(stateOf(VAULT), "force-transfer", {
			"force-transfer-destination": DESTINATION,
			"force-transfer-amount": "1",
		})

		expect(action.enabled).toBe(false)
		expect(action.fields?.at(-1)).toMatchObject({
			kind: "confirm",
			label: "Drains the vault's redemption escrow.",
		})
	})
})

describe("toComplianceTiles", () => {
	it("shows nothing without a target and pending tiles while reading", () => {
		expect(toComplianceTiles({ status: "none" })).toEqual([])
		expect(
			toComplianceTiles({ status: "checking" }).every((tile) => tile.pending),
		).toBe(true)
	})

	it("shows the allowlist, frozen state and the free balance", () => {
		expect(
			toComplianceTiles({ status: "ready", reads: reads({ frozen: true }) }),
		).toEqual([
			{ label: "Allowlisted", value: "Yes" },
			{ label: "Frozen", value: "Yes" },
			{ label: "Shares", value: "100.00" },
			{ label: "Frozen shares", value: "10.00" },
			{ label: "Free shares", value: "90.00" },
		])
	})

	it("leaves an unreadable figure empty", () => {
		const tiles = toComplianceTiles({
			status: "ready",
			reads: reads({ allowance: "unreadable", shares: null }),
		})

		expect(tiles.map((tile) => tile.value)).toEqual([
			null,
			"No",
			null,
			"10.00",
			null,
		])
	})
})

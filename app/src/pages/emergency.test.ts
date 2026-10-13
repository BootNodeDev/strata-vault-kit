import { describe, expect, it, vi } from "vitest"
import { type Grant } from "../hooks/useAdminAuthority"
import {
	type EmergencyState,
	toEmergencyActions,
	toEmergencyTiles,
} from "./emergency"

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
}))

const wallet = "GWALLETADDRESS1234"

const grantOf = (role: string, overrides: Partial<Grant> = {}): Grant => ({
	role,
	authority: wallet,
	standing: "signs-alone",
	...overrides,
})

const everyRole = [
	grantOf("vault guardian"),
	grantOf("vault governance"),
	grantOf("oracle guardian"),
	grantOf("oracle admin"),
	grantOf("share-token admin"),
]

const calm: EmergencyState = { vault: "open", token: "open", oracle: "valid" }
const alarmed: EmergencyState = {
	vault: "paused",
	token: "paused",
	oracle: "paused",
}

const ids = (state: EmergencyState, grants: Grant[]) =>
	toEmergencyActions(state, grants, wallet).map((action) => action.id)

const actionOf = (state: EmergencyState, grants: Grant[], id: string) => {
	const action = toEmergencyActions(state, grants, wallet).find(
		(candidate) => candidate.id === id,
	)
	if (action === undefined) throw new Error(`no ${id} action`)
	return action
}

describe("toEmergencyActions", () => {
	it("holds no action back on a state still being read, showing the condition as unknown", () => {
		const reading: EmergencyState = {
			vault: "checking",
			token: "checking",
			oracle: "checking",
		}

		expect(
			toEmergencyActions(reading, everyRole, wallet).every(
				(action) => action.enabled,
			),
		).toBe(true)
		expect(actionOf(reading, everyRole, "pause-vault").conditions).toEqual([
			{ label: "Vault is open", met: null },
		])
	})

	it("decides each action from its own state only", () => {
		const state: EmergencyState = {
			vault: "checking",
			token: "paused",
			oracle: "checking",
		}

		expect(actionOf(state, everyRole, "pause-vault").enabled).toBe(true)
		expect(actionOf(state, everyRole, "pause-token").enabled).toBe(false)
		expect(actionOf(state, everyRole, "unpause-token").enabled).toBe(true)
	})

	it("offers nothing to a wallet with no emergency grant", () => {
		expect(toEmergencyActions(calm, [], wallet)).toEqual([])
	})

	it("offers every emergency entrypoint to a wallet that holds every role, once each", () => {
		expect(ids(calm, everyRole)).toEqual([
			"pause-vault",
			"unpause-vault",
			"raise-ripcord",
			"lower-ripcord",
			"clear-latest",
			"pause-token",
			"unpause-token",
		])
	})

	it.each<[string, string[]]>([
		["vault guardian", ["pause-vault"]],
		["vault governance", ["unpause-vault"]],
		["oracle guardian", ["raise-ripcord"]],
		["oracle admin", ["raise-ripcord", "lower-ripcord", "clear-latest"]],
		["share-token admin", ["pause-token", "unpause-token"]],
	])("offers %s only what its guard permits", (role, expected) => {
		expect(ids(calm, [grantOf(role)])).toEqual(expected)
	})

	it("raises through raise_ripcord for the oracle guardian and set_ripcord for the oracle admin", () => {
		expect(
			actionOf(calm, [grantOf("oracle guardian")], "raise-ripcord"),
		).toMatchObject({ viaAdmin: false })
		expect(
			actionOf(calm, [grantOf("oracle admin")], "raise-ripcord"),
		).toMatchObject({ viaAdmin: true })
		expect(actionOf(calm, everyRole, "raise-ripcord")).toMatchObject({
			viaAdmin: false,
		})
	})

	it("raises through the oracle admin when the guardian grant needs more signatures", () => {
		const grants = [
			grantOf("oracle guardian", { standing: { needs: 2 } }),
			grantOf("oracle admin"),
		]

		expect(actionOf(calm, grants, "raise-ripcord")).toMatchObject({
			viaAdmin: true,
			enabled: true,
		})
	})

	it("enables pausing an open vault and token, and not unpausing them", () => {
		const actions = toEmergencyActions(calm, everyRole, wallet)
		const enabled = actions
			.filter((action) => action.enabled)
			.map((action) => action.id)

		expect(enabled).toEqual([
			"pause-vault",
			"raise-ripcord",
			"lower-ripcord",
			"pause-token",
		])
	})

	it("enables unpausing, lowering and clearing once everything is paused", () => {
		const actions = toEmergencyActions(alarmed, everyRole, wallet)
		const enabled = actions
			.filter((action) => action.enabled)
			.map((action) => action.id)

		expect(enabled).toEqual([
			"unpause-vault",
			"raise-ripcord",
			"lower-ripcord",
			"clear-latest",
			"unpause-token",
		])
	})

	it("states each precondition against the current state", () => {
		expect(actionOf(calm, everyRole, "pause-vault").conditions).toEqual([
			{ label: "Vault is open", met: true },
		])
		expect(actionOf(calm, everyRole, "unpause-vault").conditions).toEqual([
			{ label: "Vault is paused", met: false },
		])
		expect(actionOf(calm, everyRole, "clear-latest").conditions).toEqual([
			{ label: "Ripcord raised", met: false },
		])
		expect(actionOf(calm, everyRole, "lower-ripcord").conditions).toEqual([])
		expect(actionOf(alarmed, everyRole, "unpause-token").conditions).toEqual([
			{ label: "Share token is paused", met: true },
		])
	})

	it("leaves a precondition undecided when its state is unreadable", () => {
		const state: EmergencyState = {
			vault: "unreadable",
			token: "unreadable",
			oracle: "unreadable",
		}
		const actions = toEmergencyActions(state, everyRole, wallet)

		expect(actionOf(state, everyRole, "pause-vault").conditions).toEqual([
			{ label: "Vault is open", met: null },
		])
		expect(actions.every((action) => action.enabled)).toBe(true)
	})

	it("keeps raising the ripcord available once raised, noting it already is", () => {
		const raise = actionOf(alarmed, everyRole, "raise-ripcord")

		expect(raise.enabled).toBe(true)
		expect(raise.conditions).toEqual([])
		expect(raise.note).toBe("Ripcord already raised.")
		expect(actionOf(calm, everyRole, "raise-ripcord").note).toBeUndefined()
	})

	it("says what each action blocks and what stays open", () => {
		expect(actionOf(calm, everyRole, "pause-vault").outcome).toBe(
			"Stops new deposits, pricing and upgrades. Redemptions, claims, cancels and closing epochs stay open.",
		)
		expect(actionOf(calm, everyRole, "pause-token").outcome).toBe(
			"Stops holder transfers and redeem cancellations. Minting, burning and forced transfers stay open.",
		)
		expect(actionOf(alarmed, everyRole, "unpause-token").outcome).toBe(
			"Resumes holder transfers and redeem cancellations.",
		)
		expect(actionOf(calm, everyRole, "raise-ripcord").outcome).toBe(
			"Stops pricing: no epoch can be fulfilled until it is lowered. Attesting stays open.",
		)
	})

	it("marks the actions that stop something as danger, and the ones that resume as not", () => {
		const tones = Object.fromEntries(
			toEmergencyActions(calm, everyRole, wallet).map((action) => [
				action.id,
				action.tone,
			]),
		)

		expect(tones).toEqual({
			"pause-vault": "danger",
			"unpause-vault": undefined,
			"raise-ripcord": "danger",
			"lower-ripcord": undefined,
			"clear-latest": "danger",
			"pause-token": "danger",
			"unpause-token": undefined,
		})
	})

	it("disables an action whose grant the wallet cannot sign alone, saying why", () => {
		const pause = actionOf(
			calm,
			[grantOf("vault guardian", { standing: { needs: 2 } })],
			"pause-vault",
		)

		expect(pause.enabled).toBe(false)
		expect(pause.unavailable).toBe(
			"Needs 2 signatures; collecting them is not supported yet.",
		)
	})
})

describe("toEmergencyTiles", () => {
	it("shows pending tiles while reading", () => {
		const tiles = toEmergencyTiles({
			vault: "checking",
			token: "checking",
			oracle: "checking",
		})

		expect(tiles.map(({ label, pending }) => [label, pending])).toEqual([
			["Vault", true],
			["Share token", true],
			["Oracle", true],
		])
	})

	it("states each contract's current pause and the ripcord", () => {
		expect(toEmergencyTiles(calm)).toEqual([
			{ label: "Vault", value: "Open" },
			{ label: "Share token", value: "Open" },
			{ label: "Oracle", value: "Valid", note: "Ripcord not raised" },
		])
		expect(toEmergencyTiles(alarmed)).toEqual([
			{ label: "Vault", value: "Paused" },
			{ label: "Share token", value: "Paused" },
			{ label: "Oracle", value: "Paused", note: "Ripcord raised" },
		])
	})

	it("shows a stale oracle as stale with the ripcord down, and an unreadable state as unknown", () => {
		expect(
			toEmergencyTiles({ vault: "unreadable", token: "open", oracle: "stale" }),
		).toEqual([
			{ label: "Vault", value: null },
			{ label: "Share token", value: "Open" },
			{ label: "Oracle", value: "Stale", note: "Ripcord not raised" },
		])
		expect(toEmergencyTiles({ ...calm, oracle: "unreadable" })[2]).toEqual({
			label: "Oracle",
			value: null,
		})
	})
})

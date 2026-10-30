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

const calm: EmergencyState = {
	vault: "open",
	setup: "closed",
	token: "open",
	oracle: "valid",
}
const alarmed: EmergencyState = {
	vault: "paused",
	setup: "closed",
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
			setup: "checking",
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
			setup: "checking",
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
			"pause-nav",
			"unpause-nav",
			"clear-latest",
			"pause-token",
			"unpause-token",
		])
	})

	it.each<[string, string[]]>([
		["vault guardian", ["pause-vault"]],
		["vault governance", ["unpause-vault"]],
		["oracle guardian", ["pause-nav"]],
		["oracle admin", ["pause-nav", "unpause-nav", "clear-latest"]],
		["share-token admin", ["pause-token", "unpause-token"]],
	])("offers %s only what its guard permits", (role, expected) => {
		expect(ids(calm, [grantOf(role)])).toEqual(expected)
	})

	it("pauses through pause_nav for the oracle guardian and set_nav_paused for the oracle admin", () => {
		expect(
			actionOf(calm, [grantOf("oracle guardian")], "pause-nav"),
		).toMatchObject({ viaAdmin: false })
		expect(
			actionOf(calm, [grantOf("oracle admin")], "pause-nav"),
		).toMatchObject({ viaAdmin: true })
		expect(actionOf(calm, everyRole, "pause-nav")).toMatchObject({
			viaAdmin: false,
		})
	})

	it("pauses through the oracle admin when the guardian grant needs more signatures", () => {
		const grants = [
			grantOf("oracle guardian", { standing: { needs: 2 } }),
			grantOf("oracle admin"),
		]

		expect(actionOf(calm, grants, "pause-nav")).toMatchObject({
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
			"pause-nav",
			"unpause-nav",
			"pause-token",
		])
	})

	it("enables unpausing the vault, unpausing the NAV and clearing once everything is paused", () => {
		const actions = toEmergencyActions(alarmed, everyRole, wallet)
		const enabled = actions
			.filter((action) => action.enabled)
			.map((action) => action.id)

		expect(enabled).toEqual([
			"unpause-vault",
			"pause-nav",
			"unpause-nav",
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
			{ label: "NAV paused", met: false },
		])
		expect(actionOf(calm, everyRole, "unpause-nav").conditions).toEqual([])
		expect(actionOf(alarmed, everyRole, "unpause-token").conditions).toEqual([
			{ label: "Share token is paused", met: true },
		])
	})

	it("leaves a precondition undecided when its state is unreadable", () => {
		const state: EmergencyState = {
			vault: "unreadable",
			setup: "unreadable",
			token: "unreadable",
			oracle: "unreadable",
		}
		const actions = toEmergencyActions(state, everyRole, wallet)

		expect(actionOf(state, everyRole, "pause-vault").conditions).toEqual([
			{ label: "Vault is open", met: null },
		])
		expect(actions.every((action) => action.enabled)).toBe(true)
	})

	it("keeps pausing the NAV available once paused, noting it already is", () => {
		const pause = actionOf(alarmed, everyRole, "pause-nav")

		expect(pause.enabled).toBe(true)
		expect(pause.conditions).toEqual([])
		expect(pause.note).toBe("NAV already paused.")
		expect(actionOf(calm, everyRole, "pause-nav").note).toBeUndefined()
	})

	it("says what each action blocks and what stays open", () => {
		expect(actionOf(calm, everyRole, "pause-vault").outcome).toBe(
			"Stops new deposits, pricing and upgrades. Redemptions, claims, cancels and closing epochs stay open.",
		)
		expect(actionOf(calm, everyRole, "pause-token").outcome).toBe(
			"Stops holder transfers only. Minting, burning, the vault's escrow moves and legal transfers continue.",
		)
		expect(actionOf(alarmed, everyRole, "unpause-token").outcome).toBe(
			"Resumes holder transfers.",
		)
		expect(actionOf(calm, everyRole, "pause-nav").outcome).toBe(
			"Stops pricing: no epoch can be fulfilled until it is unpaused. Attesting stays open. Revoking an attester is instant; granting a replacement waits for the timelock once the oracle's setup is closed.",
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
			"pause-nav": "danger",
			"unpause-nav": undefined,
			"clear-latest": "danger",
			"pause-token": "danger",
			"unpause-token": undefined,
		})
	})

	it("offers an action whose grant needs more signatures, carrying the grant", () => {
		const shared = grantOf("vault guardian", { standing: { needs: 2 } })
		const pause = actionOf(calm, [shared], "pause-vault")

		expect(pause.enabled).toBe(true)
		expect(pause.grant).toEqual(shared)
	})
})

describe("toEmergencyTiles", () => {
	it("shows pending tiles while reading", () => {
		const tiles = toEmergencyTiles({
			vault: "checking",
			setup: "checking",
			token: "checking",
			oracle: "checking",
		})

		expect(tiles.map(({ label, pending }) => [label, pending])).toEqual([
			["Vault", true],
			["Setup", true],
			["Share token", true],
			["Oracle", true],
		])
	})

	it("states each contract's current pause and the NAV pause", () => {
		expect(toEmergencyTiles(calm)).toEqual([
			{ label: "Vault", value: "Open" },
			{
				label: "Setup",
				value: "Closed",
				note: "Changes wait for the timelock",
			},
			{ label: "Share token", value: "Open" },
			{ label: "Oracle", value: "Valid", note: "NAV not paused" },
		])
		expect(toEmergencyTiles(alarmed)).toEqual([
			{ label: "Vault", value: "Paused" },
			{
				label: "Setup",
				value: "Closed",
				note: "Changes wait for the timelock",
			},
			{ label: "Share token", value: "Paused" },
			{ label: "Oracle", value: "Paused", note: "NAV paused" },
		])
	})

	it("says setup is open beside the vault, and what that means", () => {
		expect(toEmergencyTiles({ ...calm, setup: "open" })[1]).toEqual({
			label: "Setup",
			value: "Open",
			note: "Changes apply at once; no deposits yet",
		})
		expect(toEmergencyTiles({ ...calm, setup: "unreadable" })[1]).toEqual({
			label: "Setup",
			value: null,
		})
	})

	it("shows a stale oracle as stale with the NAV not paused, and an unreadable state as unknown", () => {
		expect(
			toEmergencyTiles({
				vault: "unreadable",
				setup: "closed",
				token: "open",
				oracle: "stale",
			}),
		).toEqual([
			{ label: "Vault", value: null },
			{
				label: "Setup",
				value: "Closed",
				note: "Changes wait for the timelock",
			},
			{ label: "Share token", value: "Open" },
			{ label: "Oracle", value: "Stale", note: "NAV not paused" },
		])
		expect(toEmergencyTiles({ ...calm, oracle: "unreadable" })[3]).toEqual({
			label: "Oracle",
			value: null,
		})
	})
})

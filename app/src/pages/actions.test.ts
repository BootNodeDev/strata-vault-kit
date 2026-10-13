import { describe, expect, it, vi } from "vitest"
import { type Grant } from "../hooks/useAdminAuthority"
import {
	grantFor,
	type RailAction,
	readiness,
	readyCount,
	unavailableFor,
} from "./actions"

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
}))

const wallet = "GWALLETADDRESS1234"
const multisig = "GMULTISIGADDRESS5678"

const actionWith = (overrides: Partial<RailAction>): RailAction => ({
	id: "fund",
	label: "Fund the reserve",
	conditions: [],
	outcome: null,
	enabled: false,
	...overrides,
})

const grant = (overrides: Partial<Grant>): Grant => ({
	role: "vault guardian",
	authority: wallet,
	standing: "signs-alone",
	...overrides,
})

describe("readiness", () => {
	it("reads an enabled action as ready", () => {
		expect(readiness(actionWith({ enabled: true }))).toEqual({ kind: "ready" })
	})

	it("counts the conditions not met, an undecided one included", () => {
		const action = actionWith({
			conditions: [
				{ label: "Amount above zero", met: false },
				{ label: "Within the balance", met: null },
				{ label: "Wind-down not active", met: true },
			],
		})

		expect(readiness(action)).toEqual({ kind: "unmet", count: 2 })
	})

	it("reads an action the wallet cannot sign as unavailable, keeping the reason", () => {
		const reason = "Needs 2 signatures; collecting them is not supported yet."
		const action = actionWith({
			conditions: [{ label: "Amount above zero", met: false }],
			unavailable: reason,
		})

		expect(readiness(action)).toEqual({ kind: "unavailable", reason })
	})
})

describe("readyCount", () => {
	it("counts the enabled actions", () => {
		expect(
			readyCount([
				actionWith({ enabled: true }),
				actionWith({}),
				actionWith({ enabled: true }),
			]),
		).toBe(2)
		expect(readyCount([])).toBe(0)
	})
})

describe("grantFor", () => {
	it("prefers the grant the wallet holds itself over one it signs for", () => {
		const own = grant({})
		const viaMultisig = grant({ authority: multisig })

		expect(grantFor([viaMultisig, own], "vault guardian", wallet)).toBe(own)
	})

	it("falls back to any grant of the role, and to none for a role not held", () => {
		const viaMultisig = grant({ authority: multisig })

		expect(grantFor([viaMultisig], "vault guardian", wallet)).toBe(viaMultisig)
		expect(grantFor([viaMultisig], "oracle admin", wallet)).toBeUndefined()
	})
})

describe("unavailableFor", () => {
	it("lets a single key sign for itself", () => {
		expect(unavailableFor(grant({}), wallet)).toBeUndefined()
	})

	it("explains the signatures a multisig grant still needs", () => {
		expect(unavailableFor(grant({ standing: { needs: 2 } }), wallet)).toBe(
			"Needs 2 signatures; collecting them is not supported yet.",
		)
	})

	it("explains that signing for another account is not supported", () => {
		expect(unavailableFor(grant({ authority: multisig }), wallet)).toBe(
			"Signs for GMUL...5678; acting on its behalf is not supported yet.",
		)
	})
})

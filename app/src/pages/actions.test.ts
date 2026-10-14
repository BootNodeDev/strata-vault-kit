import { describe, expect, it, vi } from "vitest"
import { type Grant } from "../hooks/useAdminAuthority"
import {
	grantFor,
	parseAccount,
	type RailAction,
	readiness,
	readyCount,
	type Spec,
	toAction,
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

	it("reads an action with a failing or undecided condition as blocked", () => {
		const action = actionWith({
			conditions: [
				{ label: "Amount above zero", met: false },
				{ label: "Within the balance", met: null },
				{ label: "Wind-down not active", met: true },
			],
		})

		expect(readiness(action)).toEqual({ kind: "blocked" })
	})

	it("reads a closed action as blocked even with every condition passing", () => {
		const action = actionWith({
			conditions: [{ label: "Expiry ≥ 1 day", met: true }],
		})

		expect(readiness(action)).toEqual({ kind: "blocked" })
	})

	it("reads an action whose only unmet condition is no change as unchanged", () => {
		const action = actionWith({
			conditions: [
				{ label: "Notice ≤ 30d", met: true },
				{ label: "Differs from current", met: false, unchanged: true },
			],
		})

		expect(readiness(action)).toEqual({ kind: "unchanged" })
	})

	it("reads an action blocked when something besides no change fails", () => {
		const action = actionWith({
			conditions: [
				{ label: "Notice ≤ 30d", met: false },
				{ label: "Differs from current", met: false, unchanged: true },
			],
		})

		expect(readiness(action)).toEqual({ kind: "blocked" })
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

describe("toAction", () => {
	const spec = (
		overrides: Partial<Spec<"set-notice">>,
	): Spec<"set-notice"> => ({
		id: "set-notice",
		label: "Set the notice",
		conditions: [{ label: "Notice ≤ 30d", met: true }],
		outcome: null,
		...overrides,
	})

	it("enables a spec the wallet signs alone when no condition is refused", () => {
		const action = toAction(
			spec({ conditions: [{ label: "Vault is open", met: null }] }),
			grant({}),
			wallet,
		)

		expect(action.enabled).toBe(true)
		expect(action.unavailable).toBeUndefined()
	})

	it("keeps a spec that is not ready closed, even with every condition met", () => {
		expect(toAction(spec({ ready: false }), grant({}), wallet).enabled).toBe(
			false,
		)
	})

	it("keeps a refused condition closing the action", () => {
		const action = toAction(
			spec({ conditions: [{ label: "Notice ≤ 30d", met: false }] }),
			grant({}),
			wallet,
		)

		expect(action.enabled).toBe(false)
	})

	it("carries the fields, the note and the danger tone", () => {
		const field = {
			key: "notice",
			label: "Notice",
			placeholder: "7d",
			value: "3d",
			invalid: false,
		}
		const action = toAction(
			spec({ fields: [field], note: "Heads up.", danger: true }),
			grant({}),
			wallet,
		)

		expect(action).toMatchObject({
			fields: [field],
			note: "Heads up.",
			tone: "danger",
		})
	})

	it("explains a grant the wallet cannot sign alone and keeps it closed", () => {
		const action = toAction(
			spec({}),
			grant({ authority: multisig, standing: { needs: 2 } }),
			wallet,
		)

		expect(action.enabled).toBe(false)
		expect(action.unavailable).toBe(
			"Needs 2 signatures; collecting them is not supported yet.",
		)
	})
})

describe("parseAccount", () => {
	const account = "GDPO5SQDJY4E2XEE47MAOT2M2F3GR4H2AYYKSMIOT2YPOHAMC36VKWIA"
	const contract = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR"

	it.each([account, contract])("accepts %s, trimmed", (address) => {
		expect(parseAccount(`  ${address} `)).toBe(address)
	})

	it.each(["", "GABC", `${account.slice(0, -1)}B`, "SDPO5SQDJY4E2XEE"])(
		"rejects %j",
		(text) => {
			expect(parseAccount(text)).toBeUndefined()
		},
	)
})

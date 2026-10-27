import { type Amount } from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { type Grant } from "../hooks/useAdminAuthority"
import { type ConfigurationState } from "../hooks/useConfigurationState"
import {
	type ConfigurationAction,
	type ConfigurationInputs,
	toConfigurationActions,
	toConfigurationGroups,
} from "./configuration"

const WALLET = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const ACCOUNT = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"
const CONTRACT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3"
const CUSTODIAN = "CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW"
const COMPLIANCE = "CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U"
const VERIFIER = "CADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMSST"
const DAY = 86_400n
const PRICE_ONE = 10n ** 18n

const grantOf = (role: string, overrides: Partial<Grant> = {}): Grant => ({
	role,
	authority: WALLET,
	standing: "signs-alone",
	...overrides,
})

const governance = grantOf("vault governance")
const oracleAdmin = grantOf("oracle admin")
const tokenAdmin = grantOf("share-token admin")

const ready = (
	overrides: Partial<Extract<ConfigurationState, { status: "ready" }>> = {},
): ConfigurationState => ({
	status: "ready",
	depositCap: { kind: "capped", amount: 1_000_0000000n as Amount },
	custodian: { kind: "set", address: CUSTODIAN },
	notice: DAY,
	windDownDelay: 7n * DAY,
	upgradeDelay: 3n * DAY,
	setupOpen: false,
	tokenSetupOpen: true,
	oracle: {
		freshness: DAY,
		cooldown: 3_600n,
		maxUpBps: 1_000,
		maxDownBps: 500,
		min: PRICE_ONE / 2n,
		max: 2n * PRICE_ONE,
	},
	compliance: COMPLIANCE,
	identityVerifier: VERIFIER,
	...overrides,
})

const actionsFor = (
	grants: Grant[],
	inputs: ConfigurationInputs = {},
	state: ConfigurationState = ready(),
) => toConfigurationActions(state, grants, WALLET, inputs)

const find = <Id extends ConfigurationAction["id"]>(
	id: Id,
	grants: Grant[],
	inputs: ConfigurationInputs = {},
	state?: ConfigurationState,
) => {
	const action = actionsFor(grants, inputs, state).find(
		(candidate) => candidate.id === id,
	)
	if (action === undefined) throw new Error(`no ${id} action`)
	return action as Extract<ConfigurationAction, { id: Id }>
}

const condition = (action: ConfigurationAction, label: string) =>
	action.conditions.find((candidate) => candidate.label === label)?.met

describe("toConfigurationActions", () => {
	it("offers nothing without a grant or before the parameters are read", () => {
		expect(actionsFor([])).toEqual([])
		expect(actionsFor([governance], {}, { status: "checking" })).toEqual([])
	})

	it.each<[Grant, ConfigurationAction["id"][]]>([
		[
			governance,
			[
				"set-deposit-cap",
				"propose-custodian",
				"set-notice",
				"set-wind-down-delay",
			],
		],
		[oracleAdmin, ["set-oracle-config"]],
		[tokenAdmin, ["set-compliance", "set-identity-verifier"]],
	])("offers %o the setters its role guards", (grant, ids) => {
		expect(actionsFor([grant]).map((action) => action.id)).toEqual(ids)
	})

	it("prefills every field with the current value and waits for a change", () => {
		const notice = find("set-notice", [governance])

		expect(notice.fields).toEqual([
			{
				key: "notice",
				label: "Notice",
				placeholder: "7d",
				value: "1d",
				invalid: false,
				text: true,
				current: "1d",
				next: "1d",
			},
		])
		expect(condition(notice, "Differs from current")).toBe(false)
		expect(notice.enabled).toBe(false)
	})

	it("enables a notice that parses, changes and stays within both bounds", () => {
		const notice = find("set-notice", [governance], { notice: "2d 12h" })

		expect(notice.enabled).toBe(true)
		expect(notice.arg).toBe(216_000n)
		expect(notice.next).toBe("2d 12h")
		expect(notice.outcome).toBe("Applies to epochs closed from now on.")
	})

	it("names the bound a notice breaks", () => {
		const aboveUpgrade = find("set-notice", [governance], { notice: "4d" })
		const aboveCap = find(
			"set-notice",
			[governance],
			{ notice: "31d" },
			ready({ upgradeDelay: 60n * DAY }),
		)

		expect(condition(aboveUpgrade, "Notice ≤ upgrade delay 3d")).toBe(false)
		expect(condition(aboveUpgrade, "Notice ≤ 30d")).toBe(true)
		expect(aboveUpgrade.enabled).toBe(false)
		expect(condition(aboveCap, "Notice ≤ 30d")).toBe(false)
	})

	it("holds the notice while the upgrade delay is unknown", () => {
		const notice = find(
			"set-notice",
			[governance],
			{ notice: "2d" },
			ready({ upgradeDelay: null }),
		)

		expect(condition(notice, "Notice ≤ upgrade delay")).toBeNull()
		expect(notice.enabled).toBe(false)
	})

	it("flags a duration it cannot read and holds the action", () => {
		const notice = find("set-notice", [governance], { notice: "soon" })

		expect(notice.fields?.[0]).toMatchObject({ invalid: true, next: null })
		expect(notice.enabled).toBe(false)
	})

	it("caps the wind-down delay at 90 days and says what it leaves alone", () => {
		const over = find("set-wind-down-delay", [governance], {
			windDownDelay: "91d",
		})
		const within = find("set-wind-down-delay", [governance], {
			windDownDelay: "90d",
		})

		expect(condition(over, "Wind-down delay ≤ 90d")).toBe(false)
		expect(within.enabled).toBe(true)
		expect(within.arg).toBe(90n * DAY)
		expect(within.outcome).toBe(
			"A proposed wind-down keeps its activation time.",
		)
	})

	it("reads an empty deposit cap as no cap", () => {
		const cap = find("set-deposit-cap", [governance], { depositCap: "" })

		expect(cap.enabled).toBe(true)
		expect(cap.arg).toBeNull()
		expect(cap.next).toBe("No cap")
		expect(cap.fields?.[0]).toMatchObject({
			current: "1,000.00",
			next: "No cap",
		})
	})

	it("refuses a negative deposit cap and waits for a change when uncapped", () => {
		const negative = find("set-deposit-cap", [governance], { depositCap: "-1" })
		const uncapped = find(
			"set-deposit-cap",
			[governance],
			{},
			ready({ depositCap: { kind: "uncapped" } }),
		)

		expect(condition(negative, "Deposit cap ≥ 0")).toBe(false)
		expect(negative.enabled).toBe(false)
		expect(uncapped.fields?.[0]?.value).toBe("")
		expect(uncapped.enabled).toBe(false)
	})

	it("holds a deposit cap and the oracle limits at their contract edges", () => {
		const cap = (text: string) =>
			find("set-deposit-cap", [governance], { depositCap: text })
		const oracle = (inputs: ConfigurationInputs) =>
			find("set-oracle-config", [oracleAdmin], inputs)

		expect(
			condition(
				cap("17014118346046923173168730371588.4105727"),
				"Deposit cap ≤ 2^127−1",
			),
		).toBe(true)
		expect(
			condition(
				cap("17014118346046923173168730371588.4105728"),
				"Deposit cap ≤ 2^127−1",
			),
		).toBe(false)
		expect(
			condition(oracle({ freshness: "35d" }), "Freshness window ≤ 35d"),
		).toBe(true)
		expect(
			condition(oracle({ cooldown: "1d" }), "Cooldown ≤ freshness window"),
		).toBe(true)
		expect(
			condition(oracle({ maxFall: "0.01" }), "Largest fall 0.01% to 100%"),
		).toBe(true)
		expect(
			condition(oracle({ maxFall: "100" }), "Largest fall 0.01% to 100%"),
		).toBe(true)
		expect(
			condition(oracle({ ceiling: "1000000" }), "Price ceiling ≤ 1,000,000"),
		).toBe(true)
	})

	it("takes an account or a contract as custodian and says where deploys go", () => {
		for (const address of [ACCOUNT, CONTRACT]) {
			const custodian = find("propose-custodian", [governance], {
				custodian: address,
			})
			expect(custodian.enabled).toBe(true)
			expect(custodian.arg).toBe(address)
		}
		const custodian = find("propose-custodian", [governance], {
			custodian: ACCOUNT,
		})
		expect(custodian.outcome).toBe(
			"Treasury deploys to the new address from now on.",
		)
	})

	it("proposes the custodian after setup and says how long it waits", () => {
		const custodian = find("propose-custodian", [governance], {
			custodian: ACCOUNT,
		})

		expect(custodian.label).toBe("Set the custodian")
		expect(custodian.conditions).toContainEqual({
			label: "Waits for the timelock",
			met: true,
			detail: "3d",
		})
	})

	it("sets the custodian at once while setup is open", () => {
		const custodian = find(
			"set-custodian",
			[governance],
			{ custodian: ACCOUNT },
			ready({ setupOpen: true }),
		)

		expect(custodian.enabled).toBe(true)
		expect(custodian.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Setup is open",
		})
	})

	it("holds the custodian while the setup state is unknown", () => {
		const custodian = find(
			"set-custodian",
			[governance],
			{ custodian: ACCOUNT },
			ready({ setupOpen: null }),
		)

		expect(condition(custodian, "Setup state read")).toBeNull()
		expect(custodian.enabled).toBe(false)
	})

	it("proposes a lower notice after setup and keeps raising it direct", () => {
		const lower = find("propose-notice", [governance], { notice: "12h" })
		const higher = find("set-notice", [governance], { notice: "2d" })
		const same = find("set-notice", [governance], { notice: "1d" })

		expect(lower.enabled).toBe(true)
		expect(lower.arg).toBe(43_200n)
		expect(lower.label).toBe("Set the notice")
		expect(lower.conditions).toContainEqual({
			label: "Waits for the timelock",
			met: true,
			detail: "3d",
		})
		expect(higher.enabled).toBe(true)
		expect(higher.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Raising is instant",
		})
		expect(condition(same, "Differs from current")).toBe(false)
	})

	it("sets a lower notice at once while setup is open", () => {
		const notice = find(
			"set-notice",
			[governance],
			{ notice: "12h" },
			ready({ setupOpen: true }),
		)

		expect(notice.enabled).toBe(true)
		expect(condition(notice, "Applies at once")).toBe(true)
	})

	it("proposes a lower wind-down delay after setup and refuses one under 7 days", () => {
		const state = ready({ windDownDelay: 14n * DAY })
		const lower = find(
			"propose-wind-down-delay",
			[governance],
			{ windDownDelay: "8d" },
			state,
		)
		const short = find(
			"propose-wind-down-delay",
			[governance],
			{ windDownDelay: "6d" },
			state,
		)
		const raised = find(
			"set-wind-down-delay",
			[governance],
			{ windDownDelay: "20d" },
			state,
		)

		expect(lower.enabled).toBe(true)
		expect(condition(short, "Wind-down delay ≥ 7d")).toBe(false)
		expect(short.enabled).toBe(false)
		expect(raised.enabled).toBe(true)
	})

	it("keeps the deposit cap direct after setup", () => {
		const cap = find("set-deposit-cap", [governance], { depositCap: "5" })

		expect(cap.enabled).toBe(true)
		expect(cap.conditions.map(({ label }) => label)).not.toContain(
			"Waits for the timelock",
		)
	})

	it("lets the first custodian be set when none is set yet", () => {
		const unset = ready({ custodian: { kind: "unset" }, setupOpen: true })

		const blank = find("set-custodian", [governance], {}, unset)
		expect(blank.enabled).toBe(false)
		expect(blank.fields?.[0]?.current).toBe("—")

		const custodian = find(
			"set-custodian",
			[governance],
			{ custodian: ACCOUNT },
			unset,
		)
		expect(condition(custodian, "Differs from current")).toBe(true)
		expect(custodian.enabled).toBe(true)
		expect(custodian.arg).toBe(ACCOUNT)
	})

	it("holds the custodian back while the current one cannot be read", () => {
		const custodian = find(
			"set-custodian",
			[governance],
			{ custodian: ACCOUNT },
			ready({ custodian: { kind: "unreadable" }, setupOpen: true }),
		)

		expect(condition(custodian, "Differs from current")).toBeNull()
		expect(custodian.enabled).toBe(false)
	})

	it("flags an address that is not a valid key", () => {
		const custodian = find("propose-custodian", [governance], {
			custodian: "GNOPE",
		})

		expect(custodian.fields?.[0]?.invalid).toBe(true)
		expect(custodian.enabled).toBe(false)
	})

	it("takes only a contract as the compliance contract or identity verifier", () => {
		expect(
			find("set-compliance", [tokenAdmin], { compliance: ACCOUNT }).enabled,
		).toBe(false)
		expect(
			find("set-compliance", [tokenAdmin], { compliance: CONTRACT }).arg,
		).toBe(CONTRACT)
		expect(
			find("set-identity-verifier", [tokenAdmin], { identityVerifier: ACCOUNT })
				.enabled,
		).toBe(false)
		expect(
			find("set-identity-verifier", [tokenAdmin], {
				identityVerifier: CONTRACT,
			}).enabled,
		).toBe(true)
	})

	it("proposes the compliance contract and identity verifier once the token's own setup closes", () => {
		const closed = ready({ setupOpen: true, tokenSetupOpen: false })
		const compliance = find(
			"propose-compliance",
			[tokenAdmin],
			{ compliance: CONTRACT },
			closed,
		)
		const verifier = find(
			"propose-identity-verifier",
			[tokenAdmin],
			{ identityVerifier: CONTRACT },
			closed,
		)
		const waits = { label: "Waits for the timelock", met: true, detail: "3d" }

		expect(compliance).toMatchObject({
			slot: "set-compliance",
			label: "Set the compliance contract",
			arg: CONTRACT,
			enabled: true,
		})
		expect(compliance.conditions).toContainEqual(waits)
		expect(verifier).toMatchObject({
			slot: "set-identity-verifier",
			label: "Set the identity verifier",
			arg: CONTRACT,
			enabled: true,
		})
		expect(verifier.conditions).toContainEqual(waits)
	})

	it("sets the compliance contract at once while the token's setup is open, even after the vault's closes", () => {
		const compliance = find("set-compliance", [tokenAdmin], {
			compliance: CONTRACT,
		})

		expect(compliance.conditions).toContainEqual({
			label: "Applies at once",
			met: true,
			detail: "Setup is open",
		})
	})

	it("holds the token setters while the token's setup state is unknown", () => {
		const verifier = find(
			"set-identity-verifier",
			[tokenAdmin],
			{ identityVerifier: CONTRACT },
			ready({ tokenSetupOpen: null }),
		)

		expect(condition(verifier, "Setup state read")).toBeNull()
		expect(verifier.enabled).toBe(false)
	})

	it("prefills every oracle limit and sends them all when one changes", () => {
		const config = find("set-oracle-config", [oracleAdmin], { maxRise: "5" })

		expect(config.fields?.map((field) => [field.label, field.value])).toEqual([
			["Freshness window", "1d"],
			["Cooldown", "1h"],
			["Largest rise", "5"],
			["Largest fall", "5"],
			["Price floor", "0.50"],
			["Price ceiling", "2.00"],
		])
		expect(config.enabled).toBe(true)
		expect(config.arg).toEqual({
			freshness_duration: DAY,
			cooldown_secs: 3_600n,
			max_up_bps: 500,
			max_down_bps: 500,
			min_answer: PRICE_ONE / 2n,
			max_answer: 2n * PRICE_ONE,
		})
	})

	it("requires a largest fall", () => {
		const config = find("set-oracle-config", [oracleAdmin], { maxFall: "" })

		expect(config.arg).toBeUndefined()
		expect(config.enabled).toBe(false)
		expect(config.fields?.[3]).toMatchObject({
			label: "Largest fall",
			placeholder: "10",
			next: null,
		})
	})

	it.each<[ConfigurationInputs, string]>([
		[{ freshness: "0" }, "Freshness window ≥ 1s"],
		[{ freshness: "35d 1s" }, "Freshness window ≤ 35d"],
		[{ cooldown: "0" }, "Cooldown ≥ 1s"],
		[{ cooldown: "1d 1s" }, "Cooldown ≤ freshness window"],
		[{ maxRise: "0" }, "Largest rise 0.01% to 100%"],
		[{ maxRise: "100.01" }, "Largest rise 0.01% to 100%"],
		[{ maxFall: "0" }, "Largest fall 0.01% to 100%"],
		[{ maxFall: "100.01%" }, "Largest fall 0.01% to 100%"],
		[{ floor: "0" }, "Price floor > 0"],
		[{ ceiling: "0.4" }, "Price ceiling ≥ floor"],
		[{ ceiling: "1000000.01" }, "Price ceiling ≤ 1,000,000"],
	])("names the oracle limit %o breaks", (inputs, label) => {
		const config = find("set-oracle-config", [oracleAdmin], inputs)

		expect(condition(config, label)).toBe(false)
		expect(config.enabled).toBe(false)
	})

	it("sets a largest fall in basis points", () => {
		const config = find("set-oracle-config", [oracleAdmin], {
			maxFall: "12.5%",
		})

		expect(config.arg?.max_down_bps).toBe(1_250)
		expect(config.fields?.[3]?.next).toBe("12.5%")
	})

	it("opens an action to a grant the wallet cannot sign alone, carrying the grant", () => {
		const multisig = grantOf("oracle admin", {
			authority: ACCOUNT,
			standing: { needs: 2 },
		})
		const config = find("set-oracle-config", [multisig], { maxRise: "5" })

		expect(config.enabled).toBe(true)
		expect(config.grant).toBe(multisig)
	})
})

describe("toConfigurationGroups", () => {
	it("groups the current parameters by contract", () => {
		const groups = toConfigurationGroups(ready())

		expect(groups.map((group) => group.title)).toEqual([
			"Vault",
			"Oracle",
			"Share token",
		])
		expect(groups[0]?.strips).toEqual([
			[
				{ label: "Deposit cap", value: "1,000.00" },
				{ label: "Notice", value: "1d" },
				{ label: "Wind-down delay", value: "7d" },
				{ label: "Upgrade delay", value: "3d" },
			],
		])
		expect(groups[0]?.addresses).toEqual([
			{ label: "Custodian", address: CUSTODIAN },
		])
		expect(
			groups[1]?.strips.map((strip) => strip.map((tile) => tile.value)),
		).toEqual([
			["1d", "1h", "10%", "5%"],
			["0.5000", "2.0000"],
		])
		expect(groups[2]?.strips).toEqual([])
		expect(groups[2]?.addresses).toEqual([
			{ label: "Compliance contract", address: COMPLIANCE },
			{ label: "Identity verifier", address: VERIFIER },
		])
	})

	it("tells an unset custodian apart from one it could not read", () => {
		const [unset] = toConfigurationGroups(
			ready({ custodian: { kind: "unset" } }),
		)
		expect(unset?.addresses).toEqual([
			{ label: "Custodian", address: null, placeholder: "Not set" },
		])

		const [unreadable] = toConfigurationGroups(
			ready({ custodian: { kind: "unreadable" } }),
		)
		expect(unreadable?.addresses).toEqual([
			{ label: "Custodian", address: null },
		])
	})

	it("shows every figure pending while the parameters are read", () => {
		const groups = toConfigurationGroups({ status: "checking" })

		for (const group of groups) {
			for (const tile of group.strips.flat()) expect(tile.pending).toBe(true)
			for (const row of group.addresses) expect(row.pending).toBe(true)
		}
	})
})

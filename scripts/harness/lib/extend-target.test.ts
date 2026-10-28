import { describe, expect, it } from "vitest"

import { describeTarget, resolveTarget } from "./extend-target.js"
import { networkNamed } from "./network.js"

const TOML = `
[staging.network]
rpc-url = "https://rpc.example"
network-passphrase = "Test Passphrase"

[staging.contracts]
async_vault = { id = "CAAA" }
`

const RECORD_PATH = "/w/deployed.local.json"
const ENV = { INIT_CWD: "/w" }

function readFileFor(record: unknown): (path: string) => string {
	return (path) => {
		if (path.endsWith("environments.toml")) return TOML
		if (path === RECORD_PATH) return JSON.stringify(record)
		throw new Error(`unexpected read ${path}`)
	}
}

describe("resolveTarget", () => {
	const localRecord = {
		network: "local",
		contracts: { async_vault: "CV" },
		asset: { contract: "CS" },
	}

	it("uses the record's network for --config", () => {
		const target = resolveTarget(
			["--config", "deployed.local.json"],
			ENV,
			readFileFor(localRecord),
		)

		const local = networkNamed("local")
		expect(target.rpc.rpcUrl).toBe(local.rpcUrl)
		expect(target.rpc.passphrase).toBe(local.passphrase)
		expect(target.network).toBe("local")
		expect(target.contracts).toEqual([
			["async_vault", "CV"],
			["asset", "CS"],
		])
	})

	it("lets --env override the record's network", () => {
		const target = resolveTarget(
			["--config", "deployed.local.json", "--env", "staging"],
			ENV,
			readFileFor(localRecord),
		)

		expect(target.rpc.rpcUrl).toBe("https://rpc.example")
		expect(target.contracts).toEqual([
			["async_vault", "CV"],
			["asset", "CS"],
		])
		expect(target.source).toBe("--env, overriding the record's local")
	})

	it("ignores ADDRESSES_ENV when the record names its network", () => {
		const target = resolveTarget(
			["--config", "deployed.local.json"],
			{ ...ENV, ADDRESSES_ENV: "staging" },
			readFileFor(localRecord),
		)

		expect(target.network).toBe("local")
	})

	it("reads environments.toml without --config", () => {
		const target = resolveTarget([], ENV, readFileFor(undefined))

		expect(target.network).toBe("staging")
		expect(target.source).toBe("environments.toml")
		expect(target.contracts).toEqual([["async_vault", "CAAA"]])
	})

	it.each([
		{ contracts: { async_vault: "CV" } },
		{ network: "mainnet", contracts: { async_vault: "CV" } },
	])("refuses a record with no known network", (record) => {
		expect(() =>
			resolveTarget(
				["--config", "deployed.local.json"],
				ENV,
				readFileFor(record),
			),
		).toThrow(/no network of local or testnet/)
	})

	it("refuses a record that lists no contracts", () => {
		const record = { network: "local", contracts: {} }

		expect(() =>
			resolveTarget(
				["--config", "deployed.local.json"],
				ENV,
				readFileFor(record),
			),
		).toThrow(/lists no contracts/)
	})

	it("refuses contracts that are not an object", () => {
		const record = { network: "local", contracts: "oops" }

		expect(() =>
			resolveTarget(
				["--config", "deployed.local.json"],
				ENV,
				readFileFor(record),
			),
		).toThrow(/lists no contracts/)
	})

	it("refuses contracts that are not an object, even with a valid asset", () => {
		const record = {
			network: "local",
			contracts: "garbage",
			asset: { contract: "CS" },
		}

		expect(() =>
			resolveTarget(
				["--config", "deployed.local.json"],
				ENV,
				readFileFor(record),
			),
		).toThrow(/lists no contracts/)
	})

	it("refuses a contract id that is not a string", () => {
		const record = { network: "local", contracts: { async_vault: 5 } }

		expect(() =>
			resolveTarget(
				["--config", "deployed.local.json"],
				ENV,
				readFileFor(record),
			),
		).toThrow(/contract id that is not a string: async_vault/)
	})

	it.each([null, {}, { contract: 5 }])(
		"refuses an asset with no string contract",
		(asset) => {
			const record = {
				network: "local",
				contracts: { async_vault: "CV" },
				asset,
			}

			expect(() =>
				resolveTarget(
					["--config", "deployed.local.json"],
					ENV,
					readFileFor(record),
				),
			).toThrow(/contract id that is not a string: asset/)
		},
	)

	it.each(["--config", "--env"] as const)(
		"refuses a flag with no value: %s",
		(flag) => {
			expect(() => resolveTarget([flag], ENV, readFileFor(undefined))).toThrow(
				/needs a value/,
			)
		},
	)

	it("refuses --config followed by another flag as its value", () => {
		expect(() =>
			resolveTarget(
				["--config", "--env", "testnet"],
				ENV,
				readFileFor(undefined),
			),
		).toThrow(/--config needs a value/)
	})

	it.each([["rec.json"], ["--config=rec.json"], ["--confg", "x"]])(
		"refuses an argument npm let through as-is: %j",
		(...argv) => {
			expect(() => resolveTarget(argv, ENV, readFileFor(undefined))).toThrow(
				/npm run extend -w scripts\/harness -- --config <record>/,
			)
		},
	)

	it("names the file when its JSON is malformed", () => {
		expect(() =>
			resolveTarget(
				["--config", "deployed.local.json"],
				ENV,
				() => "{ not json",
			),
		).toThrow(/deployed\.local\.json/)
	})

	it("names the file when its JSON is null", () => {
		expect(() =>
			resolveTarget(["--config", "deployed.local.json"], ENV, () => "null"),
		).toThrow(/deployed\.local\.json/)
	})

	it("describes the network and RPC", () => {
		const target = resolveTarget(
			["--config", "deployed.local.json"],
			ENV,
			readFileFor(localRecord),
		)

		expect(describeTarget(target)).toBe(
			`using network local (record deployed.local.json), RPC ${networkNamed("local").rpcUrl}`,
		)
	})
})

import { describe, expect, it, vi } from "vitest"
import { contractIds, networkOf, selectedEnvironment } from "./environments.mjs"

const toml = `
[staging.network]
rpc-url = "https://rpc.example"
network-passphrase = "Test Passphrase"

[[staging.accounts]]
name = "user"

[staging.contracts]
async_vault = { id = "CAAA" }
asset = { id = "CBBB", client = true }

[development.network]
rpc-url = "http://localhost:8000/rpc"
network-passphrase = "Local Passphrase"

[development.contracts]

[development.contracts.compliance]
client = true
constructor_args = "--admin me"

[development.contracts.share_token]
client = true

[development.contracts.async_vault]
client = true
constructor_args = "--asset share_token"

[testing.network]
rpc-url = "http://localhost:8000/rpc"
network-passphrase = "Local Passphrase"

[testing.contracts]
`

describe("selectedEnvironment", () => {
	it("defaults to staging", () => {
		expect(selectedEnvironment({})).toBe("staging")
	})

	it("honours ADDRESSES_ENV", () => {
		expect(selectedEnvironment({ ADDRESSES_ENV: "production" })).toBe(
			"production",
		)
	})
})

describe("contractIds", () => {
	it("lists every deployed contract with its id", () => {
		expect(contractIds(toml, "staging")).toEqual([
			{ name: "async_vault", id: "CAAA" },
			{ name: "asset", id: "CBBB" },
		])
	})

	it("fails when the environment has no contracts section", () => {
		expect(() => contractIds(toml, "production")).toThrow(
			/no \[production\.contracts\] section/,
		)
	})

	it("fails when the section declares no ids and no contracts to deploy", () => {
		expect(() => contractIds(toml, "testing")).toThrow(
			/\[testing\.contracts\] declares no deployed addresses/,
		)
	})

	it("resolves scaffold-deployed blocks plus the asset through aliases", () => {
		const resolveAlias = vi.fn((alias) => `C${alias.toUpperCase()}`)
		expect(contractIds(toml, "development", resolveAlias)).toEqual([
			{ name: "compliance", id: "CCOMPLIANCE" },
			{ name: "share_token", id: "CSHARE_TOKEN" },
			{ name: "async_vault", id: "CASYNC_VAULT" },
			{ name: "asset", id: "CASSET" },
		])
		expect(resolveAlias).toHaveBeenCalledWith("compliance", {
			rpcUrl: "http://localhost:8000/rpc",
			networkPassphrase: "Local Passphrase",
			allowHttp: true,
		})
	})

	it("names the alias and the environment when one cannot be resolved", () => {
		const resolveAlias = (alias) => {
			if (alias === "asset") {
				throw new Error("error: no contract found with alias 'asset'")
			}
			return "CAAA"
		}
		expect(() => contractIds(toml, "development", resolveAlias)).toThrow(
			/alias 'asset' for \[development\.contracts\].*no contract found with alias 'asset'/,
		)
	})
})

describe("networkOf", () => {
	it("reads the rpc url and passphrase of the environment", () => {
		expect(networkOf(toml, "staging")).toEqual({
			rpcUrl: "https://rpc.example",
			networkPassphrase: "Test Passphrase",
			allowHttp: false,
		})
	})

	it("allows plain http only for a local rpc url", () => {
		expect(networkOf(toml, "development").allowHttp).toBe(true)
	})

	it("fails when the environment has no network section", () => {
		expect(() => networkOf(toml, "production")).toThrow(
			/no \[production\.network\] section/,
		)
	})

	it("fails when the network section lacks a key", () => {
		const partial = `[staging.network]\nrpc-url = "https://rpc.example"\n`
		expect(() => networkOf(partial, "staging")).toThrow(/network-passphrase/)
	})
})

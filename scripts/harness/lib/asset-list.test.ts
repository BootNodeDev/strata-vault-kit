import { Networks, StrKey } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import {
	assetListProblems,
	buildAssetList,
	networkOf,
	nextVersion,
	type AssetList,
	type AssetListEntry,
} from "./asset-list.js"
import { type OperatorValues, type Sep1Inputs } from "./stellar-toml.js"

const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7))
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 8))

const OPERATOR: OperatorValues = {
	ORG_NAME: "Strata Labs",
	domain: "strata.example",
	image: "https://strata.example/bv.png",
}

const inputs = (
	overrides: Partial<NonNullable<Sep1Inputs["shareToken"]>> = {},
	networkPassphrase: string = Networks.TESTNET,
): Sep1Inputs => ({
	networkPassphrase,
	shareToken: {
		contract: CONTRACT,
		code: "bvUSDC",
		name: "Strata Vault USDC",
		decimals: 7,
		...overrides,
	},
})

const ENTRY: AssetListEntry = {
	contract: CONTRACT,
	code: "bvUSDC",
	name: "Strata Vault USDC",
	org: "Strata Labs",
	domain: "strata.example",
	icon: "https://strata.example/bv.png",
	decimals: 7,
}

const LIST: AssetList = {
	name: "bvUSDC asset list",
	provider: "Strata Labs",
	version: "1.0",
	network: "testnet",
	assets: [ENTRY],
}

describe("buildAssetList", () => {
	it("builds a valid one-entry list from the chain and the operator", () => {
		const { list, missing } = buildAssetList(inputs(), OPERATOR)
		expect(missing).toEqual([])
		expect(list).toEqual(LIST)
		expect(assetListProblems(list)).toEqual([])
	})

	it("reports each unfillable field and writes no list", () => {
		const { list, missing } = buildAssetList(inputs(), {})
		expect(list).toBeUndefined()
		expect(missing.map((m) => m.field)).toEqual(
			expect.arrayContaining([
				"assetlist.org",
				"assetlist.domain",
				"assetlist.icon",
				"assetlist.provider",
			]),
		)
	})

	it("reports a missing share token", () => {
		const { list, missing } = buildAssetList({}, OPERATOR)
		expect(list).toBeUndefined()
		expect(missing.map((m) => m.field)).toEqual(
			expect.arrayContaining([
				"assetlist.contract",
				"assetlist.code",
				"assetlist.name",
				"assetlist.decimals",
			]),
		)
	})

	it("refuses a chain name SEP-42 cannot carry", () => {
		const { list, missing } = buildAssetList(inputs({ name: "bv" }), OPERATOR)
		expect(list).toBeUndefined()
		expect(missing).toContainEqual({
			field: "assetlist.name",
			reason: "must be 5 to 30 characters",
		})
	})

	it("refuses a chain code SEP-42 cannot carry", () => {
		const { list, missing } = buildAssetList(
			inputs({ code: "bv-USDC" }),
			OPERATOR,
		)
		expect(list).toBeUndefined()
		expect(missing.map((m) => m.field)).toContain("assetlist.code")
	})

	it("lets the operator override the chain code and name", () => {
		const { list } = buildAssetList(inputs({ code: "X", name: "bv" }), {
			...OPERATOR,
			code: "bvUSDC",
			name: "Strata Vault USDC",
		})
		expect(list).toEqual(LIST)
	})

	it("omits network on a local network", () => {
		const { list } = buildAssetList(
			inputs({}, "Standalone Network ; February 2017"),
			OPERATOR,
		)
		expect(list).toBeDefined()
		expect(list?.network).toBeUndefined()
		expect(assetListProblems(list)).toEqual([])
	})

	it("bumps the version from a previous list on the same network", () => {
		const previous = { ...LIST, version: "3.4" }
		const { list } = buildAssetList(
			inputs(),
			{ ...OPERATOR, image: "https://strata.example/new.png" },
			previous,
		)
		expect(list?.version).toBe("3.5")
	})

	it("starts at 1.0 when the previous list is from another network", () => {
		const previous = { ...LIST, version: "3.4", network: "public" as const }
		const { list } = buildAssetList(
			inputs(),
			{ ...OPERATOR, image: "https://strata.example/new.png" },
			previous,
		)
		expect(list?.version).toBe("1.0")
	})
})

describe("networkOf", () => {
	it("maps the public and test networks and nothing else", () => {
		expect(networkOf(Networks.PUBLIC)).toBe("public")
		expect(networkOf(Networks.TESTNET)).toBe("testnet")
		expect(networkOf("Standalone Network ; February 2017")).toBeUndefined()
		expect(networkOf(undefined)).toBeUndefined()
	})
})

describe("nextVersion", () => {
	const at = (version: string, entry: Partial<AssetListEntry> = {}) => ({
		...LIST,
		version,
		assets: [{ ...ENTRY, ...entry }] as [AssetListEntry],
	})

	it("starts at 1.0", () => {
		expect(nextVersion(undefined, ENTRY)).toBe("1.0")
	})

	it("keeps the version for an unchanged entry", () => {
		expect(nextVersion(at("3.4"), ENTRY)).toBe("3.4")
	})

	it("bumps the minor when a field other than contract changes", () => {
		expect(
			nextVersion(at("3.4"), { ...ENTRY, icon: "https://x.example/b.png" }),
		).toBe("3.5")
	})

	it("bumps the major and resets the minor when the contract changes", () => {
		expect(nextVersion(at("3.4"), { ...ENTRY, contract: OTHER_CONTRACT })).toBe(
			"4.0",
		)
	})

	it("starts over when the previous version is malformed", () => {
		expect(nextVersion(at("x"), ENTRY)).toBe("1.0")
	})
})

describe("assetListProblems", () => {
	const withEntry = (entry: Record<string, unknown>) => ({
		...LIST,
		assets: [{ ...ENTRY, ...entry }],
	})
	const rejects = (list: unknown) =>
		expect(assetListProblems(list).length).toBeGreaterThan(0)

	it("accepts a valid list", () => {
		expect(assetListProblems(LIST)).toEqual([])
	})

	it("rejects a non-object", () => {
		rejects(null)
		rejects([])
	})

	it("rejects an extra top-level key", () => rejects({ ...LIST, extra: 1 }))
	it("rejects an extra entry key", () => rejects(withEntry({ extra: 1 })))
	it("rejects a version without a minor", () =>
		rejects({ ...LIST, version: "1" }))
	it("rejects an unknown network", () => rejects({ ...LIST, network: "local" }))
	it("rejects an empty asset array", () => rejects({ ...LIST, assets: [] }))
	it("rejects a domain with a scheme", () =>
		rejects(withEntry({ domain: "https://strata.example" })))
	it("rejects an http icon", () =>
		rejects(withEntry({ icon: "http://x.example/a.png" })))
	it("rejects decimals over 38", () => rejects(withEntry({ decimals: 39 })))
	it("rejects a code with a dash", () =>
		rejects(withEntry({ code: "bv-USDC" })))
	it("rejects an org with a hash", () =>
		rejects(withEntry({ org: "Strata #1 Labs" })))

	it("accepts an IPFS icon", () => {
		expect(assetListProblems(withEntry({ icon: "bafybeigdyrzt5" }))).toEqual([])
	})

	it("accepts characters inside the CleanString range and rejects those outside", () => {
		expect(assetListProblems(withEntry({ name: "Vault: USDC" }))).toEqual([])
		rejects(withEntry({ name: "Vault# USDC" }))
	})
})

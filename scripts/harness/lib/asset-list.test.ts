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
			reason:
				'the token name must be 5 to 30 characters; set "name" in SEP1_OPERATOR',
		})
	})

	it("names the operator field to change for an invalid org", () => {
		const { missing } = buildAssetList(inputs(), {
			...OPERATOR,
			ORG_NAME: "Acme",
		})
		expect(missing).toContainEqual({
			field: "assetlist.org",
			reason: "ORG_NAME must be 5 to 30 characters",
		})
	})

	it("warns when the domain differs from the ORG_URL host", () => {
		const { warnings } = buildAssetList(inputs(), {
			...OPERATOR,
			ORG_URL: "https://other.example",
		})
		expect(warnings).toEqual([
			'warning: domain "strata.example" differs from the host of ORG_URL ("other.example")',
		])
		expect(
			buildAssetList(inputs(), {
				...OPERATOR,
				ORG_URL: "https://strata.example",
			}).warnings,
		).toEqual([])
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

describe("buildAssetList with a previous list", () => {
	it("warns and restarts at 1.0 when the previous list is invalid", () => {
		const { list, warnings } = buildAssetList(inputs(), OPERATOR, {
			...LIST,
			version: "x",
		})
		expect(list?.version).toBe("1.0")
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toMatch(
			/^warning: the previous asset list is not valid/,
		)
	})

	it("warns when the list name or provider changed", () => {
		const { warnings } = buildAssetList(
			inputs(),
			{ ...OPERATOR, ORG_NAME: "Strata Labs Inc" },
			LIST,
		)
		expect(warnings).toEqual([
			'warning: the provider changed from "Strata Labs" to "Strata Labs Inc"; SEP-42 says it should stay fixed',
		])
		const renamed = buildAssetList(inputs({ code: "bvUSDT" }), OPERATOR, LIST)
		expect(renamed.warnings[0]).toMatch(/^warning: the list name changed/)
	})

	it("never returns a list whose version overflows", () => {
		const previous = { ...LIST, version: "9999.9999" }
		const { list, missing } = buildAssetList(
			inputs(),
			{ ...OPERATOR, image: "https://strata.example/new.png" },
			previous,
		)
		expect(list).toBeUndefined()
		expect(missing.map((m) => m.field)).toContain("assetlist.version")
	})

	it("treats a previous list without assets as absent", () => {
		const { list } = buildAssetList(inputs(), OPERATOR, {
			name: "bvUSDC asset list",
			provider: "Strata Labs",
			version: "3.4",
			network: "testnet",
		} as unknown as AssetList)
		expect(list?.version).toBe("1.0")
	})

	it("treats a previous list with a non-string version as absent", () => {
		const { list } = buildAssetList(inputs(), OPERATOR, {
			...LIST,
			version: 3.4,
		} as unknown as AssetList)
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

	it("ignores the entry comment", () => {
		expect(
			nextVersion(
				at("3.4", { comment: "old" } as Partial<AssetListEntry>),
				ENTRY,
			),
		).toBe("3.4")
	})

	it("bumps the major version when an entry was removed", () => {
		const previous = {
			...at("3.4"),
			assets: [ENTRY, { ...ENTRY, contract: OTHER_CONTRACT }],
		} as unknown as AssetList
		expect(nextVersion(previous, ENTRY)).toBe("4.0")
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

	it("rejects icon and feedback URLs the schema's uri format refuses", () => {
		rejects(withEntry({ icon: "https://strata.example/my share.png" }))
		rejects(withEntry({ icon: "https://acmé.example/x.png" }))
		rejects({ ...LIST, feedback: "https://strata.example/my feedback" })
		rejects({ ...LIST, feedback: "https://acmé.example/feedback" })
	})

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

	it("bounds org to 5 to 30 characters", () => {
		expect(assetListProblems(withEntry({ org: "abcd" }))).not.toEqual([])
		expect(assetListProblems(withEntry({ org: "abcde" }))).toEqual([])
		expect(assetListProblems(withEntry({ org: "a".repeat(30) }))).toEqual([])
		expect(assetListProblems(withEntry({ org: "a".repeat(31) }))).not.toEqual(
			[],
		)
	})

	it("bounds provider to 5 to 50 characters", () => {
		expect(assetListProblems({ ...LIST, provider: "abcd" })).not.toEqual([])
		expect(assetListProblems({ ...LIST, provider: "abcde" })).toEqual([])
		expect(assetListProblems({ ...LIST, provider: "a".repeat(50) })).toEqual([])
		expect(
			assetListProblems({ ...LIST, provider: "a".repeat(51) }),
		).not.toEqual([])
	})

	it("rejects a missing contract", () =>
		rejects(withEntry({ contract: undefined })))
	it("rejects an invalid contract", () =>
		rejects(withEntry({ contract: "G" + "A".repeat(55) })))
	it("rejects more than 1000 assets", () =>
		rejects({ ...LIST, assets: Array.from({ length: 1001 }, () => ENTRY) }))
	it("rejects fractional decimals", () => rejects(withEntry({ decimals: 7.5 })))
	it("accepts the public network", () => {
		expect(assetListProblems({ ...LIST, network: "public" })).toEqual([])
	})
	it("rejects a version with a fifth digit", () =>
		rejects({ ...LIST, version: "10000.0" }))

	it("checks issuer, comment, description and feedback", () => {
		const issuer = "G" + "A".repeat(55)
		expect(assetListProblems(withEntry({ issuer }))).toEqual([])
		rejects(withEntry({ issuer: "C" + "A".repeat(55) }))
		expect(assetListProblems(withEntry({ comment: "a".repeat(150) }))).toEqual(
			[],
		)
		rejects(withEntry({ comment: "a".repeat(151) }))
		expect(
			assetListProblems({ ...LIST, description: "a".repeat(400) }),
		).toEqual([])
		rejects({ ...LIST, description: "a".repeat(401) })
		expect(
			assetListProblems({ ...LIST, feedback: "https://github.com/x/y" }),
		).toEqual([])
		rejects({ ...LIST, feedback: "not a url" })
		rejects({ ...LIST, feedback: "https://x.example/" + "a".repeat(100) })
	})
})

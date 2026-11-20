import { Networks, StrKey } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { writeAssetList } from "./asset-list-file.js"
import { type AssetList } from "./asset-list.js"
import { type OperatorValues, type Sep1Inputs } from "./stellar-toml.js"

const OPERATOR: OperatorValues = {
	ORG_NAME: "Strata Labs",
	domain: "strata.example",
	image: "https://strata.example/bv.png",
}

const inputs: Sep1Inputs = {
	networkPassphrase: Networks.TESTNET,
	shareToken: {
		contract: StrKey.encodeContract(Buffer.alloc(32, 7)),
		code: "bvUSDC",
		name: "Strata Vault USDC",
		decimals: 7,
	},
}

const run = (
	previous: string | undefined,
	operator: OperatorValues = OPERATOR,
) => {
	const written: { file: string; text: string }[] = []
	const outcome = writeAssetList({
		file: "assetlist.testnet.json",
		inputs,
		operator,
		readFile: () => {
			if (previous === undefined) throw new Error("ENOENT")
			return previous
		},
		writeFile: (file, text) => written.push({ file, text }),
	})
	return { ...outcome, written }
}

const versionOf = (text: string): string =>
	(JSON.parse(text) as AssetList).version

describe("writeAssetList", () => {
	it("starts at 1.0 when there is no previous file", () => {
		const { written, wrote, notices } = run(undefined)
		expect(wrote).toBe(true)
		expect(notices).toEqual([
			"note: no previous assetlist.testnet.json; starting at version 1.0. If a list is already hosted, save it at assetlist.testnet.json first.",
		])
		expect(written).toHaveLength(1)
		expect(written[0]?.text.endsWith("}\n")).toBe(true)
		expect(written[0]?.text).toContain('\n  "version": "1.0"')
		expect(versionOf(written[0]?.text ?? "")).toBe("1.0")
	})

	it("bumps the minor version when an entry field changes", () => {
		const first = run(undefined).written[0]?.text
		const { written } = run(first, {
			...OPERATOR,
			image: "https://strata.example/new.png",
		})
		expect(versionOf(written[0]?.text ?? "")).toBe("1.1")
	})

	it("keeps the version when nothing changed", () => {
		const first = run(undefined).written[0]?.text
		expect(versionOf(run(first).written[0]?.text ?? "")).toBe("1.0")
	})

	it("warns and starts at 1.0 when the previous file is not JSON", () => {
		const { written, notices } = run("{not json")
		expect(notices).toEqual([
			"warning: assetlist.testnet.json is not valid JSON; starting at version 1.0",
		])
		expect(versionOf(written[0]?.text ?? "")).toBe("1.0")
	})

	it("writes nothing when the list is invalid", () => {
		const { written, wrote, missing } = run(undefined, {})
		expect(wrote).toBe(false)
		expect(written).toEqual([])
		expect(missing.length).toBeGreaterThan(0)
	})
})

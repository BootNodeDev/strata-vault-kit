import { Networks, StrKey } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { latestReport, toSep1Inputs, type ChainReads } from "./sep1-reads.js"

const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7))
const FEED = StrKey.encodeContract(Buffer.alloc(32, 9))

const SHARE_TOKEN: ChainReads["shareToken"] = {
	contract: CONTRACT,
	name: "Strata Share",
	symbol: "STRATA",
	decimals: 7,
}

describe("toSep1Inputs", () => {
	it("maps share token, report and feed from fake client results", () => {
		const reads: ChainReads = {
			networkPassphrase: Networks.TESTNET,
			shareToken: SHARE_TOKEN,
			report: {
				proof_uri: "https://example.com/proof.json",
				proof_hash: Buffer.from("DEADBEEF", "hex"),
				accepted_at: 1_700_000_000n,
				expires_at: 1_800_000_000n,
			},
			feed: FEED,
		}

		expect(toSep1Inputs(reads)).toEqual({
			networkPassphrase: Networks.TESTNET,
			shareToken: {
				contract: CONTRACT,
				code: "STRATA",
				name: "Strata Share",
				decimals: 7,
			},
			report: {
				proofUri: "https://example.com/proof.json",
				proofHash: "deadbeef",
				acceptedAt: 1_700_000_000n,
				expiresAt: 1_800_000_000n,
			},
			feed: FEED,
		})
	})

	it("omits report and feed when the chain has neither", () => {
		const inputs = toSep1Inputs({
			networkPassphrase: Networks.TESTNET,
			shareToken: SHARE_TOKEN,
		})

		expect("report" in inputs).toBe(false)
		expect("feed" in inputs).toBe(false)
	})
})

function errorCase(name: string, value: number) {
	return { name: () => ({ toString: () => name }), value: () => value }
}

const REPORT = {
	proof_uri: "https://example.com/proof.json",
	proof_hash: Buffer.from("DEADBEEF", "hex"),
	accepted_at: 1_700_000_000n,
	expires_at: 1_800_000_000n,
}

describe("latestReport", () => {
	it("returns no report when the contract refuses with NoRecord", async () => {
		const reader = {
			latest: () =>
				Promise.resolve({
					result: REPORT,
					simulation: { error: "HostError: Error(Contract, #1)" },
				}),
			spec: { errorCases: () => [errorCase("NoRecord", 1)] },
		}

		await expect(latestReport(reader)).resolves.toBeUndefined()
	})

	it("throws on any other refusal", async () => {
		const reader = {
			latest: () =>
				Promise.resolve({
					result: REPORT,
					simulation: { error: "HostError: Error(Contract, #2)" },
				}),
			spec: {
				errorCases: () => [errorCase("NoRecord", 1), errorCase("Paused", 2)],
			},
		}

		await expect(latestReport(reader)).rejects.toThrow(/refused: Paused/)
	})

	it("maps an accepted report", async () => {
		const reader = {
			latest: () => Promise.resolve({ result: REPORT }),
			spec: { errorCases: () => [] },
		}

		await expect(latestReport(reader)).resolves.toEqual(REPORT)
	})
})

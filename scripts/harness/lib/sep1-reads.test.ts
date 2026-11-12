import { Networks, StrKey } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { toSep1Inputs, type ChainReads } from "./sep1-reads.js"

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

import { Keypair } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { accountRow } from "./account-table.js"

describe("accountRow", () => {
	it("lists the role, public key and balances, and never the secret key", () => {
		const key = Keypair.random()
		const row = accountRow("holder-1", key, "1.0000", "2.0000")
		expect(row).toEqual({
			Role: "holder-1",
			PublicKey: key.publicKey(),
			"USDC Balance": "1.0000",
			"Shares Balance": "2.0000",
		})
		expect(JSON.stringify(row)).not.toContain(key.secret())
	})
})

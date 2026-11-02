import { describe, expect, it } from "vitest"

import { stellarAssetGenerator } from "./asset-client.js"

describe("stellarAssetGenerator", () => {
	it("generates the Stellar Asset Contract's client without a network", async () => {
		const generator = await stellarAssetGenerator()

		const { client } = generator.generate({ contractName: "asset" })

		expect(client).toContain("export class Client")
		for (const method of ["balance", "transfer", "decimals", "clawback"]) {
			expect(client).toMatch(new RegExp(`\\b${method}\\b`))
		}
	})
})

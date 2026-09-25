import { Networks } from "@creit.tech/stellar-wallets-kit"
import { afterEach, describe, expect, it, vi } from "vitest"

const importEnv = async (network: string) => {
	vi.stubEnv("PUBLIC_STELLAR_NETWORK", network)
	vi.stubEnv("PUBLIC_STELLAR_NETWORK_PASSPHRASE", Networks.PUBLIC)
	vi.stubEnv("PUBLIC_STELLAR_RPC_URL", "https://rpc.example")
	vi.stubEnv("PUBLIC_STELLAR_HORIZON_URL", "https://horizon.example")
	vi.resetModules()
	return import("./env")
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe("explorerTransaction", () => {
	it("links to stellar.expert on the public network", async () => {
		const { explorerTransaction } = await importEnv("PUBLIC")

		expect(explorerTransaction("abcd")).toBe(
			"https://stellar.expert/explorer/public/tx/abcd",
		)
	})

	it("links to stellar.expert on testnet", async () => {
		const { explorerTransaction } = await importEnv("TESTNET")

		expect(explorerTransaction("abcd")).toBe(
			"https://stellar.expert/explorer/testnet/tx/abcd",
		)
	})

	it("has no public explorer on a network stellar.expert does not index", async () => {
		const { explorerTransaction } = await importEnv("LOCAL")

		expect(explorerTransaction("abcd")).toBeNull()
	})
})

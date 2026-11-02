import { Networks } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"
import { parseNetworkEnv } from "./networkEnv"

const local = {
	PUBLIC_STELLAR_NETWORK: "LOCAL",
	PUBLIC_STELLAR_NETWORK_PASSPHRASE: Networks.STANDALONE,
	PUBLIC_STELLAR_RPC_URL: "http://localhost:8000/rpc",
	PUBLIC_STELLAR_HORIZON_URL: "http://localhost:8000",
}

describe("parseNetworkEnv", () => {
	it("falls back to localhost when no network is configured", () => {
		expect(parseNetworkEnv({})).toEqual(local)
	})

	it("refuses a non-local network naming each missing or invalid variable", () => {
		expect(() =>
			parseNetworkEnv({
				PUBLIC_STELLAR_NETWORK: "TESTNET",
				PUBLIC_STELLAR_NETWORK_PASSPHRASE: "not a passphrase",
				PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
			}),
		).toThrow(
			"Invalid Stellar network configuration: PUBLIC_STELLAR_NETWORK_PASSPHRASE, PUBLIC_STELLAR_HORIZON_URL",
		)
	})
})

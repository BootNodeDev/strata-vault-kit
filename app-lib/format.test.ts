import { describe, expect, it } from "vitest"
import { networkPassphrase } from "./env"
import { formatNetworkName, networkStatus, shortAddress } from "./format"

describe("shortAddress", () => {
	it("truncates a 56-char G-address to first-4 + ... + last-4", () => {
		const address = "GABC1234EFGH5678IJKL9012MNOP3456QRST7890UVWX1234YZAB5678"
		expect(shortAddress(address)).toBe("GABC...5678")
	})
})

describe("formatNetworkName", () => {
	it("labels STANDALONE as Local", () => {
		expect(formatNetworkName("STANDALONE")).toBe("Local")
	})

	it("capitalizes other network names", () => {
		expect(formatNetworkName("TESTNET")).toBe("Testnet")
	})
})

describe("networkStatus", () => {
	it("is disconnected when there is no address", () => {
		const status = networkStatus(undefined, undefined)
		expect(status.state).toBe("disconnected")
	})

	it("is unverified when the wallet reports no passphrase", () => {
		const status = networkStatus("GADDRESS", undefined)
		expect(status.state).toBe("unverified")
	})

	it("is a mismatch when the wallet passphrase is unrecognized", () => {
		const status = networkStatus("GADDRESS", "Unknown Passphrase")
		expect(status.state).toBe("mismatch")
		expect(status.walletNetwork).toBe("Unknown")
	})

	it("is ok when the wallet passphrase matches the app's network", () => {
		const status = networkStatus("GADDRESS", networkPassphrase)
		expect(status.state).toBe("ok")
		expect(status.title).toBe("")
	})
})

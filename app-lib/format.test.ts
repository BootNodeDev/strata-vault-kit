import { describe, expect, it } from "vitest"
import { networkPassphrase } from "./env"
import {
	AMOUNT_DECIMALS,
	type Amount,
	formatDate,
	formatNetworkName,
	formatScaled,
	formatUnits,
	networkStatus,
	parseUnits,
	type Price,
	shortAddress,
	toSafeNumber,
} from "./format"

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

describe("formatUnits", () => {
	it("stays exact above Number.MAX_SAFE_INTEGER without ever building a Number", () => {
		// integer part is MAX_SAFE_INTEGER + 1, fraction is a full 7-digit remainder
		const value = 90071992547409921234567n as Amount
		expect(formatUnits(value, AMOUNT_DECIMALS)).toBe("9007199254740992.12")
		expect(formatUnits(value, AMOUNT_DECIMALS, 7)).toBe(
			"9007199254740992.1234567",
		)
	})

	it("splits the sign, formats the magnitude, then re-prefixes it", () => {
		const value = -25000000n as Amount
		expect(formatUnits(value, AMOUNT_DECIMALS)).toBe("-2.50")
	})

	it("truncates extra fraction digits instead of rounding up", () => {
		const value = 19999999n as Amount
		expect(formatUnits(value, AMOUNT_DECIMALS)).toBe("1.99")
	})
})

describe("parseUnits", () => {
	it("trims, strips commas and whitespace, then parses the magnitude", () => {
		expect(parseUnits(" 1,234.50 ", AMOUNT_DECIMALS)).toBe(12345000000n)
	})

	it("returns the negative bigint for a negative input", () => {
		expect(parseUnits("-2.5", AMOUNT_DECIMALS)).toBe(-25000000n)
	})

	it.each(["1e5", "1.2.3", "+5", ".", ""])(
		"rejects %j as unparseable",
		(input) => {
			expect(parseUnits(input, AMOUNT_DECIMALS)).toBeNull()
		},
	)

	it("rejects more fraction digits than decimals instead of silently truncating", () => {
		expect(parseUnits("1.12345678", AMOUNT_DECIMALS)).toBeNull()
	})
})

describe("toSafeNumber", () => {
	it("is sign-symmetric", () => {
		expect(toSafeNumber(25000000n as Amount)).toBe(2.5)
		expect(toSafeNumber(-25000000n as Amount)).toBe(-2.5)
	})

	it("returns the value at the MAX_SAFE_INTEGER boundary", () => {
		const atBoundary = (BigInt(Number.MAX_SAFE_INTEGER) *
			10n ** BigInt(AMOUNT_DECIMALS)) as Amount
		expect(toSafeNumber(atBoundary)).toBe(Number.MAX_SAFE_INTEGER)
	})

	it("returns null at the boundary when a fraction would round past it", () => {
		const atBoundaryWithFraction = (BigInt(Number.MAX_SAFE_INTEGER) *
			10n ** BigInt(AMOUNT_DECIMALS) +
			5000000n) as Amount
		expect(toSafeNumber(atBoundaryWithFraction)).toBeNull()
	})

	it("returns null when the integer part exceeds MAX_SAFE_INTEGER", () => {
		const aboveBoundary = ((BigInt(Number.MAX_SAFE_INTEGER) + 1n) *
			10n ** BigInt(AMOUNT_DECIMALS)) as Amount
		expect(toSafeNumber(aboveBoundary)).toBeNull()
	})
})

describe("formatScaled", () => {
	it("groups the integer part with thousands separators", () => {
		const value = 184000000000n as Amount
		expect(formatScaled(value, AMOUNT_DECIMALS)).toBe("18,400.00")
	})

	it("splits the sign, groups the magnitude, then re-prefixes it", () => {
		const value = -25000000n as Amount
		expect(formatScaled(value, AMOUNT_DECIMALS)).toBe("-2.50")
	})

	it("keeps the sign when the magnitude is smaller than one whole unit", () => {
		const value = -5000000n as Amount
		expect(formatScaled(value, AMOUNT_DECIMALS)).toBe("-0.50")
	})

	it("stays exact above Number.MAX_SAFE_INTEGER", () => {
		const value = 90071992547409921234567n as Amount
		expect(formatScaled(value, AMOUNT_DECIMALS)).toBe(
			"9,007,199,254,740,992.12",
		)
	})
})

describe("formatDate", () => {
	it("renders a ledger timestamp in UTC, not the local calendar day", () => {
		const timestamp = BigInt(Date.UTC(2026, 8, 16, 0, 30, 0) / 1000)

		expect(formatDate(timestamp)).toBe("16 Sep 2026")

		const nonUtcRendering = new Intl.DateTimeFormat("en-US", {
			day: "numeric",
			month: "short",
			year: "numeric",
			timeZone: "America/New_York",
		}).format(new Date(Number(timestamp) * 1000))
		expect(nonUtcRendering).toBe("Sep 15, 2026")
		expect(formatDate(timestamp)).not.toBe(nonUtcRendering)
	})

	it("does not throw for a saturated u64::MAX timestamp", () => {
		expect(formatDate(18446744073709551615n)).toBe("—")
	})

	it("does not throw for a timestamp outside the Date range", () => {
		expect(formatDate(-8640000000001n)).toBe("—")
	})

	it("formats the largest representable timestamp instead of rejecting it", () => {
		expect(formatDate(8_640_000_000_000n)).toBe("13 Sep 275760")
	})
})

it("rejects a Price formatted with AMOUNT_DECIMALS at compile time", () => {
	const price = 1_000000000000000000n as Price
	// @ts-expect-error a Price must be formatted with PRICE_DECIMALS, not AMOUNT_DECIMALS
	expect(typeof formatUnits(price, AMOUNT_DECIMALS)).toBe("string")
})

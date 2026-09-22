import {
	type Amount,
	formatDate,
	formatScaled,
	PRICE_DECIMALS,
	type Price,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { type NavClassification } from "../hooks/useNavPrice"
import { type VaultAuthorities } from "../hooks/useVaultAuthorities"
import { type VaultFigures } from "../hooks/useVaultFigures"
import {
	toAuthorityRows,
	toMetrics,
	toPriceMetric,
	toSizeFigures,
} from "./vaultMetrics"

const amount = (value: bigint): Amount => value as Amount

const readFigures: VaultFigures = {
	liquidReserve: amount(184000000000n),
	committed: amount(62000000000n),
	uncovered: amount(0n),
	economicSupply: amount(10000000000000n),
	netDeployed: amount(0n),
}

const readAuthorities: VaultAuthorities = {
	governance: "GGOVERNANCEADDRESS1234",
	manager: null,
	treasury: null,
	guardian: null,
	custodian: null,
}

describe("toMetrics", () => {
	it("renders the three liquidity metrics from readable figures, using the reported token symbol", () => {
		const [liquidReserve, committed, uncovered] = toMetrics(
			readFigures,
			false,
			"USDC",
		)

		expect(liquidReserve).toEqual({
			label: "Liquid reserve",
			value: "18,400.00",
			note: "USDC the vault holds now",
		})
		expect(committed).toEqual({
			label: "Committed",
			value: "6,200.00",
			note: "USDC owed on priced claims",
		})
		expect(uncovered).toEqual({
			label: "Uncovered · vault",
			value: "0.00",
			note: "Every claim is covered",
		})
	})

	it("renders an unavailable figure as no value at all", () => {
		const [, committed] = toMetrics(
			{ ...readFigures, committed: null },
			false,
			"USDC",
		)

		expect(committed.value).toBeNull()
	})

	it("sets pending and never a value while the figures are still loading", () => {
		const metrics = toMetrics(undefined, true, "USDC")

		for (const metric of metrics) {
			expect(metric.pending).toBe(true)
			expect(metric.value).toBeNull()
		}
	})

	it.each([
		[0n, "Every claim is covered"],
		[500000000n, "USDC still needed"],
		[null, "Could not read the vault"],
	])(
		"derives the uncovered note from the read value (%s)",
		(uncovered, note) => {
			const [, , uncoveredMetric] = toMetrics(
				{
					...readFigures,
					uncovered: uncovered === null ? null : amount(uncovered),
				},
				false,
				"USDC",
			)
			expect(uncoveredMetric.note).toBe(note)
		},
	)

	it("notes uncovered as not-yet-known while pending, using the reported token symbol", () => {
		const [, , uncoveredMetric] = toMetrics(undefined, true, "USDC")
		expect(uncoveredMetric.note).toBe("USDC not covered")
	})
})

describe("toAuthorityRows", () => {
	it("maps a present address to a linkable row", () => {
		const [governance] = toAuthorityRows(readAuthorities, false)
		expect(governance).toEqual({
			label: "Governance",
			address: "GGOVERNANCEADDRESS1234",
		})
	})

	it("maps a present-but-null authority and a missing record identically to null", () => {
		const [, manager] = toAuthorityRows(readAuthorities, false)
		expect(manager).toEqual({ label: "Manager", address: null })

		const [, missingManager] = toAuthorityRows(undefined, false)
		expect(missingManager).toEqual({ label: "Manager", address: null })
	})

	it("sets pending and never an address while loading", () => {
		const rows = toAuthorityRows(undefined, true)
		for (const row of rows) {
			expect(row.pending).toBe(true)
			expect(row.address).toBeNull()
		}
	})
})

describe("toPriceMetric", () => {
	const attestedAt = BigInt(Date.UTC(2026, 8, 16) / 1000)
	const expiresAt = BigInt(Date.UTC(2026, 8, 20) / 1000)
	const price = 1500000000000000000n as Price

	it("renders the attested price and attestation date when valid", () => {
		const nav: NavClassification = { status: "valid", price, attestedAt }

		expect(toPriceMetric(nav, false)).toEqual({
			label: "Share price",
			value: formatScaled(price, PRICE_DECIMALS, 4),
			note: `Attested ${formatDate(attestedAt)}`,
		})
	})

	it("renders no value and the expiry date when stale", () => {
		const nav: NavClassification = { status: "stale", expiresAt }

		expect(toPriceMetric(nav, false)).toEqual({
			label: "Share price",
			value: null,
			note: `Price expired ${formatDate(expiresAt)}`,
		})
	})

	it("renders no value when the oracle is paused", () => {
		expect(toPriceMetric({ status: "paused" }, false)).toEqual({
			label: "Share price",
			value: null,
			note: "Oracle paused",
		})
	})

	it("renders no value when the oracle has never been attested", () => {
		expect(toPriceMetric({ status: "never" }, false)).toEqual({
			label: "Share price",
			value: null,
			note: "No price attested yet",
		})
	})

	it("renders no value when the oracle read is unreadable", () => {
		expect(toPriceMetric({ status: "unreadable" }, false)).toEqual({
			label: "Share price",
			value: null,
			note: "Could not read the oracle",
		})
	})

	it("sets pending and never a value while the oracle is still loading", () => {
		expect(toPriceMetric(undefined, true)).toEqual({
			label: "Share price",
			value: null,
			note: "Reading the oracle",
			pending: true,
		})
	})
})

describe("toSizeFigures", () => {
	it("renders net deployed of zero, distinguishable from unavailable", () => {
		const [, netDeployed] = toSizeFigures(readFigures, false)
		expect(netDeployed).toEqual({ label: "Net deployed", value: "0.00" })
	})

	it("renders a size figure whose read failed with no value", () => {
		const [economicSupply] = toSizeFigures(
			{ ...readFigures, economicSupply: null },
			false,
		)
		expect(economicSupply!.value).toBeNull()
	})

	it("sets pending and never a value while loading", () => {
		const rows = toSizeFigures(undefined, true)
		for (const row of rows) {
			expect(row.pending).toBe(true)
			expect(row.value).toBeNull()
		}
	})
})

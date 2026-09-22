import { type Amount } from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { type VaultFigures } from "../hooks/useVaultFigures"
import { toMetrics } from "./vaultMetrics"

const amount = (value: bigint): Amount => value as Amount

const readFigures: VaultFigures = {
	liquidReserve: amount(184000000000n),
	committed: amount(62000000000n),
	uncovered: amount(0n),
	economicSupply: amount(10000000000000n),
	netDeployed: amount(0n),
}

describe("toMetrics", () => {
	it("renders the three liquidity metrics from readable figures", () => {
		const [liquidReserve, committed, uncovered] = toMetrics(readFigures, false)

		expect(liquidReserve).toEqual({
			label: "Liquid reserve",
			value: "18,400.00",
			note: "TOKEN the vault holds now",
		})
		expect(committed).toEqual({
			label: "Committed",
			value: "6,200.00",
			note: "TOKEN owed on priced claims",
		})
		expect(uncovered).toEqual({
			label: "Uncovered · vault",
			value: "0.00",
			note: "Every claim is covered",
		})
	})

	it("renders an unavailable figure as no value at all", () => {
		const [, committed] = toMetrics({ ...readFigures, committed: null }, false)

		expect(committed.value).toBeNull()
	})

	it("sets pending and never a value while the figures are still loading", () => {
		const metrics = toMetrics(undefined, true)

		for (const metric of metrics) {
			expect(metric.pending).toBe(true)
			expect(metric.value).toBeNull()
		}
	})

	it.each([
		[0n, "Every claim is covered"],
		[500000000n, "TOKEN still needed"],
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
			)
			expect(uncoveredMetric.note).toBe(note)
		},
	)

	it("notes uncovered as not-yet-known while pending", () => {
		const [, , uncoveredMetric] = toMetrics(undefined, true)
		expect(uncoveredMetric.note).toBe("TOKEN not covered")
	})
})

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import MetricsStrip, { type Metric } from "./MetricsStrip"

const metrics: [Metric, Metric, Metric, Metric] = [
	{
		label: "Net assets",
		value: "23,310.00",
		note: "On-chain reserve + custodian",
	},
	{
		label: "Total supply",
		value: "22,539.16",
		note: "vTOKEN issued, escrow included",
	},
	{ label: "Share price", value: "1.0342", note: "Attested 31 Aug 2026" },
	{ label: "Open epoch", value: "E-18", note: "Takes new requests" },
]

describe("MetricsStrip", () => {
	it("renders the four labels and values it is given", () => {
		render(<MetricsStrip metrics={metrics} />)

		for (const metric of metrics) {
			expect(screen.getByText(metric.label)).toBeTruthy()
			expect(screen.getByText(metric.value as string)).toBeTruthy()
		}
	})

	it("renders an em dash for a value that could not be read", () => {
		const unread = metrics.map((metric) => ({ ...metric, value: null })) as [
			Metric,
			Metric,
			Metric,
			Metric,
		]

		render(<MetricsStrip metrics={unread} />)

		expect(screen.getAllByText("—")).toHaveLength(4)
	})
})

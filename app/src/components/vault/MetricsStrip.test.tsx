import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import MetricsStrip, { type Metric } from "./MetricsStrip"

const metrics: [Metric, Metric, Metric, Metric] = [
	{ label: "Share price", value: "1.0342", note: "Attested 31 Aug 2026" },
	{
		label: "Liquid reserve",
		value: "18,400.00",
		note: "TOKEN the vault holds now",
	},
	{
		label: "Committed",
		value: "6,200.00",
		note: "TOKEN owed on priced claims",
	},
	{
		label: "Uncovered · vault",
		value: "0.00",
		note: "Every claim is covered",
	},
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

	it("distinguishes a pending cell from one that could not be read", () => {
		const mixed: [Metric, Metric, Metric, Metric] = [
			{ ...metrics[0], value: null, pending: true },
			{ ...metrics[1], value: null },
			metrics[2],
			metrics[3],
		]

		render(<MetricsStrip metrics={mixed} />)

		expect(screen.getByRole("progressbar")).toBeTruthy()
		expect(screen.getByText("—")).toBeTruthy()
	})
})

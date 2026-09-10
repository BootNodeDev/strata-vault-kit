import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import RequestCard, { type ActiveRequest } from "./RequestCard"

const pendingRequest: ActiveRequest = {
	state: "Pending",
	side: "Subscription",
	tone: "pending",
	rows: [
		{ label: "In escrow", value: "1,000.00 TOKEN", tone: "value" },
		{ label: "Epoch", value: "E-18 · open", tone: "value" },
		{ label: "You receive", value: "Set at pricing", tone: "word" },
	],
}

describe("RequestCard", () => {
	it("renders the chip, the side, and every row it is given", () => {
		render(
			<RequestCard
				title="Active request"
				request={pendingRequest}
				emptyMessage="No open request."
			/>,
		)

		expect(screen.getByText("Pending")).toBeTruthy()
		expect(screen.getByText("Subscription")).toBeTruthy()
		for (const row of pendingRequest.rows) {
			expect(screen.getByText(row.label)).toBeTruthy()
			expect(screen.getByText(row.value as string)).toBeTruthy()
		}
	})

	it("renders an em dash for a row value that could not be read", () => {
		render(
			<RequestCard
				title="Active request"
				request={{
					...pendingRequest,
					rows: [{ label: "Reserve covers", value: null }],
				}}
				emptyMessage="No open request."
			/>,
		)

		expect(screen.getByText("—")).toBeTruthy()
	})

	it("renders the empty message when there is no open request", () => {
		render(
			<RequestCard
				title="Active request"
				request={null}
				emptyMessage="Your requests appear here."
			/>,
		)

		expect(screen.getByText("Your requests appear here.")).toBeTruthy()
	})
})

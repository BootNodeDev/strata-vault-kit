import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import RequestCard, { type RequestEntry } from "./RequestCard"

const baseEntry: RequestEntry = {
	id: 1,
	title: "Redemption",
	state: "Priced · not payable yet",
	tone: "blocked",
	rows: [{ label: "Priced at", value: "1.0290 · 5 Sep 2026" }],
	actions: [],
}

describe("RequestCard", () => {
	it("renders an unavailable action and does not call it on click", () => {
		const onPress = vi.fn()
		render(
			<RequestCard
				entry={{
					...baseEntry,
					actions: [
						{
							label: "Claim (reserve does not cover this yet)",
							kind: "unavailable",
							onPress,
						},
					],
				}}
			/>,
		)

		const button = screen.getByRole("button", {
			name: "Claim (reserve does not cover this yet)",
		}) as HTMLButtonElement
		expect(button.disabled).toBe(true)
		fireEvent.click(button)
		expect(onPress).not.toHaveBeenCalled()
	})

	it("renders every row of its nested coverage block", () => {
		render(
			<RequestCard
				entry={{
					...baseEntry,
					coverage: {
						label: "This claim",
						rows: [
							{ label: "Owed to you", value: "12,348.00 TOKEN" },
							{ label: "Reserve covers", value: "4,200.00 TOKEN" },
							{ label: "Still needed", value: "8,148.00 TOKEN", tone: "stop" },
						],
					},
				}}
			/>,
		)

		expect(screen.getByText("This claim")).toBeTruthy()
		expect(screen.getByText("Owed to you")).toBeTruthy()
		expect(screen.getByText("12,348.00 TOKEN")).toBeTruthy()
		expect(screen.getByText("Reserve covers")).toBeTruthy()
		expect(screen.getByText("Still needed")).toBeTruthy()
		expect(screen.getByText("8,148.00 TOKEN")).toBeTruthy()
	})
})

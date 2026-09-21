import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import RequestCard, { partitionByStage, type RequestEntry } from "./RequestCard"

const baseEntry: RequestEntry = {
	id: 1,
	inLabel: "Redemption",
	inAmount: "12,000.00 vTOKEN",
	inMeta: "Requested 28 Aug 2026",
	outLabel: "Owed to you",
	outAmount: "12,348.00 TOKEN",
	state: "Priced",
	tone: "blocked",
	actions: [],
}

describe("RequestCard", () => {
	it("renders an unavailable action and does not call it on click", () => {
		const onPress = vi.fn()
		render(
			<RequestCard
				entry={{
					...baseEntry,
					actions: [{ label: "Claim", kind: "unavailable", onPress }],
				}}
				tipOpen={false}
				onToggleTip={() => {}}
			/>,
		)

		const button = screen.getByRole("button", {
			name: "Claim",
		}) as HTMLButtonElement
		expect(button.disabled).toBe(true)
		fireEvent.click(button)
		expect(onPress).not.toHaveBeenCalled()
	})

	it("renders the out column with the label and amount it is given", () => {
		render(
			<RequestCard entry={baseEntry} tipOpen={false} onToggleTip={() => {}} />,
		)

		expect(screen.getByText("Owed to you")).toBeTruthy()
		expect(screen.getByText("12,348.00 TOKEN")).toBeTruthy()
	})

	it("opens its tooltip on click", () => {
		const onToggleTip = vi.fn()
		const { rerender } = render(
			<RequestCard
				entry={{
					...baseEntry,
					tooltip: {
						label: "Why you cannot claim this yet",
						text: "Awaiting a top-up, with no date promised.",
					},
				}}
				tipOpen={false}
				onToggleTip={onToggleTip}
			/>,
		)

		expect(screen.queryByRole("tooltip")).toBeNull()

		const trigger = screen.getByRole("button", {
			name: "Why you cannot claim this yet",
		})
		fireEvent.click(trigger)
		expect(onToggleTip).toHaveBeenCalledTimes(1)

		rerender(
			<RequestCard
				entry={{
					...baseEntry,
					tooltip: {
						label: "Why you cannot claim this yet",
						text: "Awaiting a top-up, with no date promised.",
					},
				}}
				tipOpen={true}
				onToggleTip={onToggleTip}
			/>,
		)

		expect(screen.getByRole("tooltip").textContent).toBe(
			"Awaiting a top-up, with no date promised.",
		)
	})
})

describe("partitionByStage", () => {
	it("groups claimable entries as ready and pending or blocked entries as waiting", () => {
		const claimable: RequestEntry = { ...baseEntry, id: 1, tone: "claimable" }
		const pending: RequestEntry = { ...baseEntry, id: 2, tone: "pending" }
		const blocked: RequestEntry = { ...baseEntry, id: 3, tone: "blocked" }
		const secondClaimable: RequestEntry = {
			...baseEntry,
			id: 4,
			tone: "claimable",
		}

		const groups = partitionByStage([
			claimable,
			pending,
			blocked,
			secondClaimable,
		])

		expect(groups.ready).toEqual([claimable, secondClaimable])
		expect(groups.waiting).toEqual([pending, blocked])
	})
})

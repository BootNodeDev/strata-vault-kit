import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type RequestEntry } from "./RequestCard"
import RequestList, { type RequestGroup } from "./RequestList"

const readyEntry: RequestEntry = {
	id: 1,
	inLabel: "Subscription",
	inAmount: "1,000.00 TOKEN",
	inMeta: "Requested 5 Sep 2026",
	outLabel: "You claim",
	outAmount: "966.93 vTOKEN",
	state: "Claimable",
	tone: "claimable",
	actions: [],
}

const waitingEntries: RequestEntry[] = [
	{
		id: 2,
		inLabel: "Redemption",
		inAmount: "12,000.00 vTOKEN",
		inMeta: "Requested 28 Aug 2026",
		outLabel: "Owed to you",
		outAmount: "12,348.00 TOKEN",
		state: "Priced",
		tone: "blocked",
		actions: [],
	},
	{
		id: 3,
		inLabel: "Subscription",
		inAmount: "500.00 TOKEN",
		inMeta: "Requested 10 Sep 2026",
		outLabel: "",
		outAmount: "≈ 483.55 vTOKEN",
		state: "Request",
		tone: "pending",
		actions: [],
	},
	{
		id: 4,
		inLabel: "Redemption",
		inAmount: "200.00 vTOKEN",
		inMeta: "Requested —",
		outLabel: "",
		outAmount: "≈ 206.84 TOKEN",
		state: "Request",
		tone: "pending",
		actions: [],
	},
]

const baseGroups: [RequestGroup, RequestGroup] = [
	{
		id: "ready",
		label: "Ready to claim",
		entries: [readyEntry],
		emptyMessage: "Nothing to claim yet.",
	},
	{
		id: "waiting",
		label: "Waiting",
		entries: waitingEntries,
		emptyMessage: "Nothing is waiting.",
	},
]

describe("RequestList", () => {
	it("shows both tab counts before either tab is activated", () => {
		render(
			<RequestList
				heading="Your requests"
				groups={baseGroups}
				activeStage="ready"
				onStageChange={() => {}}
				openTooltipId={null}
				onToggleTooltip={() => {}}
			/>,
		)

		expect(screen.getByRole("tab", { name: "Ready to claim 1" })).toBeTruthy()
		expect(screen.getByRole("tab", { name: "Waiting 3" })).toBeTruthy()
	})

	it("renders only the active stage's cards", () => {
		render(
			<RequestList
				heading="Your requests"
				groups={baseGroups}
				activeStage="ready"
				onStageChange={() => {}}
				openTooltipId={null}
				onToggleTooltip={() => {}}
			/>,
		)

		expect(screen.getByText("966.93 vTOKEN")).toBeTruthy()
		expect(screen.queryByText("12,348.00 TOKEN")).toBeNull()
		expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
	})

	it("calls onStageChange with the clicked tab's stage", () => {
		const onStageChange = vi.fn()
		render(
			<RequestList
				heading="Your requests"
				groups={baseGroups}
				activeStage="ready"
				onStageChange={onStageChange}
				openTooltipId={null}
				onToggleTooltip={() => {}}
			/>,
		)

		fireEvent.click(screen.getByRole("tab", { name: "Waiting 3" }))
		expect(onStageChange).toHaveBeenCalledWith("waiting")
	})

	it.each([
		["ready", "Ready to claim 1", "ArrowRight", "waiting"],
		["ready", "Ready to claim 1", "ArrowLeft", "waiting"],
		["ready", "Ready to claim 1", "Home", "ready"],
		["ready", "Ready to claim 1", "End", "waiting"],
		["waiting", "Waiting 3", "ArrowRight", "ready"],
		["waiting", "Waiting 3", "ArrowLeft", "ready"],
		["waiting", "Waiting 3", "Home", "ready"],
		["waiting", "Waiting 3", "End", "waiting"],
	] as const)(
		"with %s selected, pressing %s on %s calls onStageChange with %s",
		(activeStage, tabName, key, expectedStage) => {
			const onStageChange = vi.fn()
			render(
				<RequestList
					heading="Your requests"
					groups={baseGroups}
					activeStage={activeStage}
					onStageChange={onStageChange}
					openTooltipId={null}
					onToggleTooltip={() => {}}
				/>,
			)

			fireEvent.keyDown(screen.getByRole("tab", { name: tabName }), { key })
			expect(onStageChange).toHaveBeenCalledWith(expectedStage)
		},
	)

	it("keeps only the selected tab in the roving tab order", () => {
		render(
			<RequestList
				heading="Your requests"
				groups={baseGroups}
				activeStage="waiting"
				onStageChange={() => {}}
				openTooltipId={null}
				onToggleTooltip={() => {}}
			/>,
		)

		expect(screen.getByRole("tab", { name: "Ready to claim 1" }).tabIndex).toBe(
			-1,
		)
		expect(screen.getByRole("tab", { name: "Waiting 3" }).tabIndex).toBe(0)
	})

	it("shows each stage's own empty message when it has no entries", () => {
		const emptyGroups: [RequestGroup, RequestGroup] = [
			{
				id: "ready",
				label: "Ready to claim",
				entries: [],
				emptyMessage: "Nothing to claim right now.",
			},
			{
				id: "waiting",
				label: "Waiting",
				entries: [],
				emptyMessage: "Nothing is waiting right now.",
			},
		]

		const { rerender } = render(
			<RequestList
				heading="Your requests"
				groups={emptyGroups}
				activeStage="ready"
				onStageChange={() => {}}
				openTooltipId={null}
				onToggleTooltip={() => {}}
			/>,
		)

		expect(screen.getByText("Nothing to claim right now.")).toBeTruthy()

		rerender(
			<RequestList
				heading="Your requests"
				groups={emptyGroups}
				activeStage="waiting"
				onStageChange={() => {}}
				openTooltipId={null}
				onToggleTooltip={() => {}}
			/>,
		)

		expect(screen.getByText("Nothing is waiting right now.")).toBeTruthy()
	})
})

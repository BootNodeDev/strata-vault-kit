import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import RequestList, { type RequestGroup } from "./RequestList"

const emptyGroups: RequestGroup[] = [
	{ heading: "Ready to claim", caption: "priced and covered", entries: [] },
	{ heading: "Waiting", caption: "priced, not claimable yet", entries: [] },
]

describe("RequestList", () => {
	it("renders its banner only when given one", () => {
		const { rerender } = render(
			<RequestList
				heading="Your open requests"
				count="0 open"
				groups={emptyGroups}
				emptyMessage="You have no open requests."
			/>,
		)

		expect(screen.queryByText("Two claims are racing")).toBeNull()

		rerender(
			<RequestList
				heading="Your open requests"
				count="0 open"
				groups={emptyGroups}
				emptyMessage="You have no open requests."
				banner={{
					label: "Two claims are racing",
					body: "The reserve is not held for this claim.",
				}}
			/>,
		)

		expect(screen.getByText("Two claims are racing")).toBeTruthy()
	})

	it("renders neither the heading nor the caption of a group with no entries", () => {
		render(
			<RequestList
				heading="Your open requests"
				count="0 open"
				groups={emptyGroups}
				emptyMessage="You have no open requests."
			/>,
		)

		expect(screen.queryByText("Ready to claim")).toBeNull()
		expect(screen.queryByText("priced and covered")).toBeNull()
		expect(screen.queryByText("Waiting")).toBeNull()
		expect(screen.queryByText("priced, not claimable yet")).toBeNull()
		expect(screen.getByText("You have no open requests.")).toBeTruthy()
	})
})

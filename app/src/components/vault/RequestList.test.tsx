import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import RequestList from "./RequestList"

describe("RequestList", () => {
	it("renders its banner only when given one", () => {
		const { rerender } = render(
			<RequestList
				heading="Your open requests"
				count="0 open"
				entries={[]}
				emptyMessage="You have no open requests."
			/>,
		)

		expect(screen.queryByText("Two claims are racing")).toBeNull()

		rerender(
			<RequestList
				heading="Your open requests"
				count="0 open"
				entries={[]}
				emptyMessage="You have no open requests."
				banner={{
					label: "Two claims are racing",
					body: "The reserve is not held for this claim.",
				}}
			/>,
		)

		expect(screen.getByText("Two claims are racing")).toBeTruthy()
	})
})

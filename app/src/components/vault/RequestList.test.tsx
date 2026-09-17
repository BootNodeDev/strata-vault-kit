import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import RequestList from "./RequestList"

describe("RequestList", () => {
	it("renders its empty message when there are no entries", () => {
		render(
			<RequestList
				heading="Your open requests"
				countLabel={(open) => `${open} open`}
				entries={[]}
				emptyMessage="You have no open requests."
				openTooltipId={null}
				onToggleTooltip={() => {}}
			/>,
		)

		expect(screen.getByText("You have no open requests.")).toBeTruthy()
	})
})

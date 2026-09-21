import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import PositionCard from "./PositionCard"

describe("PositionCard", () => {
	it("renders an em dash when the value could not be read", () => {
		render(
			<PositionCard
				heading="Your position"
				label="Your shares"
				value={null}
				sub="Not read"
			/>,
		)

		expect(screen.getByText("—")).toBeTruthy()
	})
})

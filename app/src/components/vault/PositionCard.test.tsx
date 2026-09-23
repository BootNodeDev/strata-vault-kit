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

	it("renders a loading indicator, not a value, while pending", () => {
		render(
			<PositionCard
				heading="Your position"
				label="Your shares"
				value={null}
				sub="In your wallet"
				pending
			/>,
		)

		expect(screen.getByRole("progressbar")).toBeTruthy()
		expect(screen.queryByText("—")).toBeNull()
	})

	it("renders a genuine zero as itself, distinguishable from the em dash", () => {
		render(
			<PositionCard
				heading="Your position"
				label="Your shares"
				value="0.00 vTOKEN"
				sub="In your wallet"
			/>,
		)

		expect(screen.getByText("0.00 vTOKEN")).toBeTruthy()
		expect(screen.queryByText("—")).toBeNull()
	})
})

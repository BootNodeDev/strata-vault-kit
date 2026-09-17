import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import VaultPreview from "./VaultPreview"

describe("VaultPreview", () => {
	it("renders the action panel in the side column", () => {
		render(<VaultPreview />)

		const side = screen.getByRole("complementary", { name: "Actions" })
		expect(
			screen.getByRole("heading", { name: "Request a subscription" }),
		).toBeTruthy()
		expect(side.childElementCount).toBeGreaterThan(0)
	})
})

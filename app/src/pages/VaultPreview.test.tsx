import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import VaultPreview from "./VaultPreview"

describe("VaultPreview", () => {
	it("reserves an empty side column for the action panel", () => {
		render(<VaultPreview />)

		const side = screen.getByRole("complementary", { name: "Actions" })
		expect(side.childElementCount).toBe(0)
	})
})

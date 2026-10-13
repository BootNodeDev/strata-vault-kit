import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import SurfaceTabs from "./SurfaceTabs"

const renderAt = (path: string) =>
	render(
		<MemoryRouter initialEntries={[path]}>
			<SurfaceTabs surfaces={["cycle", "emergency"]} />
		</MemoryRouter>,
	)

describe("SurfaceTabs", () => {
	it("links each given surface under the admin path, in the given order", () => {
		renderAt("/admin/cycle")

		const nav = screen.getByRole("navigation", { name: "Admin surfaces" })
		const links = within(nav).getAllByRole("link")
		expect(links.map((link) => link.textContent)).toEqual([
			"Cycle",
			"Emergency",
		])
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"/admin/cycle",
			"/admin/emergency",
		])
	})

	it("marks only the surface at the current path as the current page", () => {
		renderAt("/admin/emergency")

		expect(
			screen
				.getByRole("link", { name: "Emergency" })
				.getAttribute("aria-current"),
		).toBe("page")
		expect(
			screen.getByRole("link", { name: "Cycle" }).getAttribute("aria-current"),
		).toBeNull()
	})
})

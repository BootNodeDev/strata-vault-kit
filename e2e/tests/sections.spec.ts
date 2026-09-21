import { expect, test } from "@playwright/test"

const sections = [
	{ link: "Requests", heading: "Your requests" },
	{ link: "Position", heading: "Your position" },
	{ link: "About", heading: "About this vault" },
]

test("every section link brings its section into view", async ({ page }) => {
	// Narrow enough that the layout is one column and nothing is already on
	// screen, so a link that scrolled nowhere fails instead of passing.
	await page.setViewportSize({ width: 900, height: 600 })
	await page.goto("/")

	const nav = page.getByRole("navigation", { name: "Sections" })
	await expect(nav.getByRole("link")).toHaveCount(sections.length)

	for (const section of sections) {
		await page.evaluate(() => window.scrollTo(0, 0))
		await nav.getByRole("link", { name: section.link }).click()
		await expect(
			page.getByRole("heading", { name: section.heading }),
		).toBeInViewport()
	}
})

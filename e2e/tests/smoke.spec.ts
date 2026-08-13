import { expect, test } from "@playwright/test"

// Deliberately asserts nothing about page copy. The landing page is still the
// scaffold's placeholder and gets replaced by the investor interface in E3; a
// test bound to that copy would be deleted along with it.
test("the app shell mounts and renders the wallet controls", async ({
	page,
}) => {
	await page.goto("/")

	await expect(page.locator("#root")).not.toBeEmpty()
	await expect(page.locator(".connect-account")).toBeVisible()
})

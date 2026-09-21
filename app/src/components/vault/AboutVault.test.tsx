import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AboutVault, { type AddressGroup } from "./AboutVault"

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerContract: (address: string) => `https://explorer.test/${address}`,
}))

const groups: AddressGroup[] = [
	{
		title: "Contracts",
		rows: [{ label: "Vault", source: "config", address: "CVAULTADDRESS1234" }],
	},
	{
		title: "Authorities",
		rows: [{ label: "Governance", source: "placeholder" }],
	},
]

describe("AboutVault", () => {
	it("links a configured address to the explorer and leaves a placeholder unlinked", () => {
		render(
			<AboutVault
				summary={["What this vault is.", "How a request settles."]}
				groups={groups}
			/>,
		)

		const [contracts, authorities] = screen.getAllByRole("list")
		const [vault] = within(contracts!).getAllByRole("listitem")
		const [governance] = within(authorities!).getAllByRole("listitem")

		expect(
			within(vault!)
				.getByRole("link", { name: "CVAU...1234" })
				.getAttribute("href"),
		).toBe("https://explorer.test/CVAULTADDRESS1234")
		expect(within(governance!).queryByRole("link")).toBeNull()
		expect(screen.getByText("How a request settles.")).toBeTruthy()
	})
})

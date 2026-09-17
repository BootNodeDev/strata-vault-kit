import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AboutVault, { type AddressGroup, type RuleGroup } from "./AboutVault"

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerContract: (address: string) => `https://explorer.test/${address}`,
}))

const rules: RuleGroup = {
	title: "How a request settles",
	items: [
		"One request per side per batch.",
		"One price for everyone in the batch.",
	],
}

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
				summary="What this vault is."
				rules={rules}
				groups={groups}
			/>,
		)

		const [ruleList, contracts, authorities] = screen.getAllByRole("list")
		const [vault] = within(contracts!).getAllByRole("listitem")
		const [governance] = within(authorities!).getAllByRole("listitem")

		expect(
			within(vault!)
				.getByRole("link", { name: "CVAU...1234" })
				.getAttribute("href"),
		).toBe("https://explorer.test/CVAULTADDRESS1234")
		expect(within(governance!).queryByRole("link")).toBeNull()
		expect(
			within(ruleList!).getByText("One request per side per batch."),
		).toBeTruthy()
	})
})

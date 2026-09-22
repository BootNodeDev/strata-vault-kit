import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AboutVault, { type AddressGroup, type FigureGroup } from "./AboutVault"

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerContract: (address: string) => `https://explorer.test/${address}`,
}))

const figures: FigureGroup = {
	title: "Vault size",
	rows: [{ label: "Economic supply", value: "1,000.00" }],
}

const renderAboutVault = (groups: AddressGroup[]): ReturnType<typeof render> =>
	render(
		<AboutVault
			summary={["What this vault is.", "How a request settles."]}
			figures={figures}
			groups={groups}
		/>,
	)

describe("AboutVault", () => {
	it("links a configured address to the explorer", () => {
		renderAboutVault([
			{
				title: "Contracts",
				rows: [{ label: "Vault", address: "CVAULTADDRESS1234" }],
			},
		])

		const [, contracts] = screen.getAllByRole("list")
		const [row] = within(contracts!).getAllByRole("listitem")

		expect(
			within(row!)
				.getByRole("link", { name: "CVAU...1234" })
				.getAttribute("href"),
		).toBe("https://explorer.test/CVAULTADDRESS1234")
	})

	it("renders an authority that was never set as Unavailable with no link", () => {
		renderAboutVault([
			{ title: "Authorities", rows: [{ label: "Custodian", address: null }] },
		])

		const [, authorities] = screen.getAllByRole("list")
		const [row] = within(authorities!).getAllByRole("listitem")

		expect(within(row!).getByText("Unavailable")).toBeTruthy()
		expect(within(row!).queryByRole("link")).toBeNull()
	})

	it("renders an authority whose read failed identically to one never set", () => {
		renderAboutVault([
			{ title: "Authorities", rows: [{ label: "Guardian", address: null }] },
		])

		const [, authorities] = screen.getAllByRole("list")
		const [row] = within(authorities!).getAllByRole("listitem")

		expect(within(row!).getByText("Unavailable")).toBeTruthy()
		expect(within(row!).queryByRole("link")).toBeNull()
	})

	it("renders a pending row as a loading indicator", () => {
		renderAboutVault([
			{
				title: "Authorities",
				rows: [{ label: "Manager", address: null, pending: true }],
			},
		])

		expect(screen.getByRole("progressbar")).toBeTruthy()
	})

	it("renders the figures group before the address groups", () => {
		renderAboutVault([
			{
				title: "Contracts",
				rows: [{ label: "Vault", address: "CVAULTADDRESS1234" }],
			},
		])

		const headings = screen.getAllByText(/Vault size|Contracts/)
		expect(headings.map((heading) => heading.textContent)).toEqual([
			"Vault size",
			"Contracts",
		])
	})
})

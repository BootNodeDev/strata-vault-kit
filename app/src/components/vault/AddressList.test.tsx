import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AddressList, { type AddressGroup } from "./AddressList"

const groups: AddressGroup[] = [
	{
		title: "Contracts",
		rows: [
			{ label: "Vault", source: "config", address: "CVAULTADDRESS1234" },
			{ label: "Asset", source: "config", address: "CASSETADDRESS5678" },
		],
	},
	{
		title: "Authorities",
		rows: [{ label: "Governance", source: "placeholder" }],
	},
]

describe("AddressList", () => {
	it("copies one row's address without affecting the other rows", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(globalThis.navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})

		render(<AddressList groups={groups} />)
		const [contracts, authorities] = screen.getAllByRole("list")
		const [vault, asset] = within(contracts!).getAllByRole("listitem")

		within(vault!).getByRole("button", { name: "Copy" }).click()

		expect(writeText).toHaveBeenCalledWith("CVAULTADDRESS1234")
		await within(vault!).findByRole("button", { name: "Copied" })
		expect(within(asset!).getByRole("button", { name: "Copy" })).toBeTruthy()

		const [governance] = within(authorities!).getAllByRole("listitem")
		expect(
			within(governance!).getByText("Not read from the vault"),
		).toBeTruthy()
	})
})

import { shortAddress } from "@stellar-scaffold/app-lib"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type AddressRow } from "../components/vault/AddressList"
import VaultPreview from "./VaultPreview"

const { mockVaultId } = vi.hoisted(() => ({
	mockVaultId: "CMOCKVAULTADDRESS1234567890",
}))

vi.mock("../config/contracts", () => {
	const contractRows: AddressRow[] = [
		{ label: "Vault", source: "config", address: mockVaultId },
	]
	return { vaultContractId: mockVaultId, contractRows }
})

describe("VaultPreview", () => {
	it("renders the action panel in the side column", () => {
		render(<VaultPreview />)

		const side = screen.getByRole("complementary", { name: "Actions" })
		expect(
			screen.getByRole("heading", { name: "Request a subscription" }),
		).toBeTruthy()
		expect(side.childElementCount).toBeGreaterThan(0)
	})

	it("resolves every nav link to a section present in the page", () => {
		const { container } = render(<VaultPreview />)

		const nav = screen.getByRole("navigation", { name: "Sections" })
		const links = nav.querySelectorAll("a")
		expect(links).toHaveLength(4)
		links.forEach((link) => {
			const id = link.getAttribute("href")?.slice(1)
			expect(container.querySelector(`#${id}`)).toBeTruthy()
		})
	})

	it("renders the header and the Vault row from the same configured address", () => {
		render(<VaultPreview />)

		expect(screen.getAllByText(shortAddress(mockVaultId))).toHaveLength(2)
	})
})

import { shortAddress } from "@stellar-scaffold/app-lib"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type AddressRow } from "../components/vault/AboutVault"
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

	it("renders the header and the Vault row from the same configured address", () => {
		render(<VaultPreview />)

		expect(screen.getAllByText(shortAddress(mockVaultId))).toHaveLength(2)
	})

	it("shows both stage tab counts and switches which requests are shown", () => {
		render(<VaultPreview />)

		expect(screen.getByRole("tab", { name: "Ready to claim 1" })).toBeTruthy()
		expect(screen.getByRole("tab", { name: "Waiting 3" })).toBeTruthy()

		expect(screen.getByText("966.93 vTOKEN")).toBeTruthy()
		expect(screen.queryByText("12,348.00 TOKEN")).toBeNull()

		fireEvent.click(screen.getByRole("tab", { name: "Waiting 3" }))

		expect(screen.getByText("12,348.00 TOKEN")).toBeTruthy()
		expect(screen.queryByText("966.93 vTOKEN")).toBeNull()
	})

	it("closes an open tooltip when the stage changes and does not restore it", () => {
		render(<VaultPreview />)

		fireEvent.click(screen.getByRole("tab", { name: "Waiting 3" }))
		fireEvent.click(
			screen.getByRole("button", { name: "Why you cannot claim this yet" }),
		)
		expect(screen.getByRole("tooltip")).toBeTruthy()

		fireEvent.click(screen.getByRole("tab", { name: "Ready to claim 1" }))
		expect(screen.queryByRole("tooltip")).toBeNull()

		fireEvent.click(screen.getByRole("tab", { name: "Waiting 3" }))
		expect(screen.queryByRole("tooltip")).toBeNull()
	})

	it("states one of the four batch-settlement rules in the vault explainer", () => {
		render(<VaultPreview />)

		expect(screen.getByText(/one request per side per batch/i)).toBeTruthy()
	})
})

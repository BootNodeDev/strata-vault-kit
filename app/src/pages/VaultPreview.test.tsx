import { shortAddress } from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
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

vi.mock("../config/clients", () => {
	const figure = (result: bigint) => async () => ({ result })
	const vault = {
		liquid_reserve: figure(184000000000n),
		committed: figure(62000000000n),
		uncovered: figure(0n),
		total_economic_supply: figure(0n),
		net_deployed: figure(0n),
	}

	return { asyncVault: async () => vault }
})

const renderVaultPreview = (): ReturnType<typeof render> => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return render(<VaultPreview />, { wrapper })
}

describe("VaultPreview", () => {
	it("renders the action panel in the side column", () => {
		renderVaultPreview()

		const side = screen.getByRole("complementary", { name: "Actions" })
		expect(
			screen.getByRole("heading", { name: "Request a subscription" }),
		).toBeTruthy()
		expect(side.childElementCount).toBeGreaterThan(0)
	})

	it("renders the header and the Vault row from the same configured address", () => {
		renderVaultPreview()

		expect(screen.getAllByText(shortAddress(mockVaultId))).toHaveLength(2)
	})

	it("shows both stage tab counts and switches which requests are shown", () => {
		renderVaultPreview()

		expect(screen.getByRole("tab", { name: "Ready to claim 1" })).toBeTruthy()
		expect(screen.getByRole("tab", { name: "Waiting 3" })).toBeTruthy()

		expect(screen.getByText("966.93 vTOKEN")).toBeTruthy()
		expect(screen.queryByText("12,348.00 TOKEN")).toBeNull()

		fireEvent.click(screen.getByRole("tab", { name: "Waiting 3" }))

		expect(screen.getByText("12,348.00 TOKEN")).toBeTruthy()
		expect(screen.queryByText("966.93 vTOKEN")).toBeNull()
	})

	it("closes an open tooltip when the stage changes and does not restore it", () => {
		renderVaultPreview()

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
		renderVaultPreview()

		expect(screen.getByText(/one request per side per batch/i)).toBeTruthy()
	})

	it("renders the liquidity figures the vault reports, scaled and grouped", async () => {
		renderVaultPreview()

		expect(await screen.findByText("18,400.00")).toBeTruthy()
		expect(screen.getByText("6,200.00")).toBeTruthy()
		expect(screen.getByText("0.00")).toBeTruthy()
	})
})

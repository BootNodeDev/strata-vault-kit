import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as UseAdminAuthority from "../hooks/useAdminAuthority"
import { type AdminAuthority } from "../hooks/useAdminAuthority"
import AdminPanel from "./AdminPanel"

const { useAdminAuthorityMock, useWalletMock } = vi.hoisted(() => ({
	useAdminAuthorityMock: vi.fn(),
	useWalletMock: vi.fn(),
}))

vi.mock("../hooks/useAdminAuthority", async (importOriginal) => {
	const actual = await importOriginal<typeof UseAdminAuthority>()
	return { ...actual, useAdminAuthority: useAdminAuthorityMock }
})

vi.mock("../hooks/useWallet", () => ({ useWallet: useWalletMock }))

const connectedAddress = "GCONNECTEDADDRESS1234567890"

const emptyGrantedBy = {
	cycle: [] as string[],
	compliance: [] as string[],
	emergency: [] as string[],
	configuration: [] as string[],
	governance: [] as string[],
}

const noAddresses = { oracle: null, shareToken: null, identityVerifier: null }

const authority = (overrides: Partial<AdminAuthority>): AdminAuthority => ({
	status: "disconnected",
	surfaces: new Set(),
	grantedBy: emptyGrantedBy,
	roles: [],
	addresses: noAddresses,
	...overrides,
})

describe("AdminPanel", () => {
	beforeEach(() => {
		useWalletMock.mockReturnValue({ address: connectedAddress })
	})

	it("tells a disconnected wallet to connect, with no cards and no identity line", () => {
		useAdminAuthorityMock.mockReturnValue(authority({ status: "disconnected" }))
		render(<AdminPanel />)

		expect(
			screen.getByText("Connect a wallet to operate this vault."),
		).toBeTruthy()
		expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0)
		expect(screen.queryByText(/GCON/)).toBeNull()
	})

	it("shows a pending skeleton while checking, with no identity line", () => {
		useAdminAuthorityMock.mockReturnValue(authority({ status: "checking" }))
		render(<AdminPanel />)

		expect(screen.getAllByRole("progressbar")).toHaveLength(2)
		expect(screen.queryByText(/GCON/)).toBeNull()
	})

	it("reports when the vault's authorities could not be read, with no identity line", () => {
		useAdminAuthorityMock.mockReturnValue(authority({ status: "unreadable" }))
		render(<AdminPanel />)

		expect(
			screen.getByText("Could not read the vault's authorities."),
		).toBeTruthy()
		expect(screen.queryByText(/GCON/)).toBeNull()
	})

	it("tells an address with no role it holds no authority, listing just the shortened address", () => {
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				addresses: {
					oracle: "CORACLE",
					shareToken: "CTOKEN",
					identityVerifier: "CVERIFIER",
				},
			}),
		)
		render(<AdminPanel />)

		expect(
			screen.getByText("This address holds no authority on this vault."),
		).toBeTruthy()
		expect(screen.getByText("Addresses")).toBeTruthy()
		expect(screen.getByText("Oracle")).toBeTruthy()
		expect(screen.getByText("GCON...7890")).toBeTruthy()
	})

	it("renders a card per held surface, in Cycle · Compliance · Emergency · Configuration · Governance order", () => {
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["governance", "cycle", "emergency"]),
				grantedBy: {
					...emptyGrantedBy,
					cycle: ["vault manager"],
					emergency: ["vault guardian", "oracle guardian"],
					governance: ["vault governance"],
				},
				roles: ["vault manager", "vault guardian", "oracle guardian"],
			}),
		)
		render(<AdminPanel />)

		const headings = screen.getAllByRole("heading", { level: 2 })
		expect(headings.map((heading) => heading.textContent)).toEqual([
			"Cycle",
			"Emergency",
			"Governance",
		])
		expect(
			screen.getByText("Granted by vault guardian, oracle guardian"),
		).toBeTruthy()
		expect(
			screen.queryByText("This address holds no authority on this vault."),
		).toBeNull()
		expect(
			screen.getByText(
				"GCON...7890 · vault manager · vault guardian · oracle guardian",
			),
		).toBeTruthy()
	})
})

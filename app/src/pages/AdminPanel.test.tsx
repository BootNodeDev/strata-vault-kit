import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as UseAdminAuthority from "../hooks/useAdminAuthority"
import { type AdminAuthority, type Grant } from "../hooks/useAdminAuthority"
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

vi.mock("../components/admin/CycleSection", () => ({
	default: ({ grants }: { grants: Grant[] }) => (
		<div>Cycle surface for {grants.map((grant) => grant.role).join(", ")}</div>
	),
}))

const connectedAddress = "GCONNECTEDADDRESS1234567890"

const emptyGrantedBy = {
	cycle: [] as Grant[],
	compliance: [] as Grant[],
	emergency: [] as Grant[],
	configuration: [] as Grant[],
	governance: [] as Grant[],
}

const holderOf = (role: string): Grant => ({
	role,
	authority: connectedAddress,
	standing: "signs-alone",
})

const noAddresses = { oracle: null, shareToken: null, identityVerifier: null }

const authority = (overrides: Partial<AdminAuthority>): AdminAuthority => ({
	status: "disconnected",
	surfaces: new Set(),
	grantedBy: emptyGrantedBy,
	grants: [],
	signersUnknown: false,
	addresses: noAddresses,
	...overrides,
})

const renderAt = (path: string) =>
	render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/admin" element={<AdminPanel />} />
				<Route path="/admin/:surface" element={<AdminPanel />} />
			</Routes>
		</MemoryRouter>,
	)

const currentTab = () =>
	screen
		.getAllByRole("link")
		.find((link) => link.getAttribute("aria-current") === "page")?.textContent

describe("AdminPanel", () => {
	beforeEach(() => {
		useWalletMock.mockReturnValue({ address: connectedAddress })
	})

	it("tells a disconnected wallet to connect, with no tabs and no identity line", () => {
		useAdminAuthorityMock.mockReturnValue(authority({ status: "disconnected" }))
		renderAt("/admin")

		expect(
			screen.getByText("Connect a wallet to operate this vault."),
		).toBeTruthy()
		expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0)
		expect(screen.queryByText(/GCON/)).toBeNull()
	})

	it("shows a pending skeleton while checking, with no identity line", () => {
		useAdminAuthorityMock.mockReturnValue(authority({ status: "checking" }))
		renderAt("/admin")

		expect(screen.getAllByRole("progressbar")).toHaveLength(2)
		expect(screen.queryByText(/GCON/)).toBeNull()
	})

	it("reports when the vault's authorities could not be read, with no identity line", () => {
		useAdminAuthorityMock.mockReturnValue(authority({ status: "unreadable" }))
		renderAt("/admin")

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
		renderAt("/admin")

		expect(
			screen.getByText("This address holds no authority on this vault."),
		).toBeTruthy()
		expect(screen.getByText("Addresses")).toBeTruthy()
		expect(screen.getByText("Oracle")).toBeTruthy()
		expect(screen.getByText("GCON...7890")).toBeTruthy()
	})

	it("keeps the page-level states free of surface tabs", () => {
		useAdminAuthorityMock.mockReturnValue(authority({ status: "checking" }))
		renderAt("/admin/cycle")

		expect(screen.queryByRole("navigation")).toBeNull()
		expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0)
	})

	it("tabs only the held surfaces, in Cycle · Compliance · Emergency · Configuration · Governance order", () => {
		const manager = holderOf("vault manager")
		const guardian = holderOf("vault guardian")
		const oracleGuardian = holderOf("oracle guardian")
		const governance = holderOf("vault governance")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["governance", "cycle", "emergency"]),
				grantedBy: {
					...emptyGrantedBy,
					cycle: [manager],
					emergency: [guardian, oracleGuardian],
					governance: [governance],
				},
				grants: [manager, guardian, oracleGuardian, governance],
			}),
		)
		renderAt("/admin/emergency")

		const nav = screen.getByRole("navigation", { name: "Admin surfaces" })
		expect(nav.textContent).toBe("CycleEmergencyGovernance")
		expect(currentTab()).toBe("Emergency")
		expect(
			screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
		).toEqual(["Emergency"])
		expect(screen.queryByText(/Granted by/)).toBeNull()
		expect(
			screen.queryByText("This address holds no authority on this vault."),
		).toBeNull()
		expect(
			screen.getByText(
				"GCON...7890 · vault manager · vault guardian · oracle guardian · vault governance",
			),
		).toBeTruthy()
	})

	it("opens the first held surface at /admin", () => {
		const guardian = holderOf("vault guardian")
		const governance = holderOf("vault governance")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["governance", "emergency"]),
				grantedBy: {
					...emptyGrantedBy,
					emergency: [guardian],
					governance: [governance],
				},
				grants: [guardian, governance],
			}),
		)
		renderAt("/admin")

		expect(currentTab()).toBe("Emergency")
		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
			"Emergency",
		)
	})

	it("redirects a surface the wallet does not hold to the first held one, showing nothing of it", () => {
		const compliance = holderOf("share-token compliance")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["compliance"]),
				grantedBy: { ...emptyGrantedBy, compliance: [compliance] },
				grants: [compliance],
			}),
		)
		renderAt("/admin/cycle")

		expect(currentTab()).toBe("Compliance")
		expect(screen.queryByRole("heading", { name: "Cycle" })).toBeNull()
		expect(screen.queryByText(/Cycle surface/)).toBeNull()
	})

	it("redirects an unknown surface to the first held one", () => {
		const manager = holderOf("vault manager")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["cycle"]),
				grantedBy: { ...emptyGrantedBy, cycle: [manager] },
				grants: [manager],
			}),
		)
		renderAt("/admin/treasury")

		expect(currentTab()).toBe("Cycle")
		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Cycle")
	})

	it("moves focus to the surface heading when the tab changes, not on first load", () => {
		const manager = holderOf("vault manager")
		const compliance = holderOf("share-token compliance")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["cycle", "compliance"]),
				grantedBy: {
					...emptyGrantedBy,
					cycle: [manager],
					compliance: [compliance],
				},
				grants: [manager, compliance],
			}),
		)
		renderAt("/admin")

		expect(document.activeElement).not.toBe(
			screen.getByRole("heading", { name: "Cycle" }),
		)

		fireEvent.click(screen.getByRole("link", { name: "Compliance" }))

		expect(currentTab()).toBe("Compliance")
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "Compliance" }),
		)
	})

	it("names the signature standing of every grant on the identity line", () => {
		const governance: Grant = {
			role: "vault governance",
			authority: "GGOVERNANCEMULTISIG",
			standing: "signs-alone",
		}
		const attester: Grant = {
			role: "oracle attester",
			authority: "GATTESTERMULTISIG",
			standing: { needs: 2 },
		}
		const compliance: Grant = {
			role: "share-token compliance",
			authority: "GCOMPLIANCEMULTISIG",
			standing: { weight: 1, threshold: 3 },
		}
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["cycle", "compliance", "governance"]),
				grantedBy: {
					...emptyGrantedBy,
					cycle: [attester],
					compliance: [compliance],
					governance: [governance],
				},
				grants: [attester, compliance, governance],
			}),
		)
		renderAt("/admin")

		expect(
			screen.getByText(
				"GCON...7890 · oracle attester (1 of 2 signatures) · share-token compliance (weight 1 of threshold 3) · vault governance (signs alone)",
			),
		).toBeTruthy()
	})

	it("hands the Cycle surface every grant that opened it, so its actions follow the wallet's roles", () => {
		const manager = holderOf("vault manager")
		const treasury = holderOf("vault treasury")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["cycle"]),
				grantedBy: { ...emptyGrantedBy, cycle: [manager, treasury] },
				grants: [manager, treasury],
			}),
		)
		renderAt("/admin/cycle")

		expect(
			screen.getByText("Cycle surface for vault manager, vault treasury"),
		).toBeTruthy()
	})

	it("says nothing extra when the wallet is the holder itself", () => {
		const manager = holderOf("vault manager")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["cycle"]),
				grantedBy: { ...emptyGrantedBy, cycle: [manager] },
				grants: [manager],
			}),
		)
		renderAt("/admin")

		expect(screen.getByText("GCON...7890 · vault manager")).toBeTruthy()
		expect(screen.queryByText("Signer lookup unavailable.")).toBeNull()
	})

	it("names the standing of the wallet's own key when it cannot act alone", () => {
		const governance: Grant = {
			role: "vault governance",
			authority: connectedAddress,
			standing: { needs: 2 },
		}
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["governance"]),
				grantedBy: { ...emptyGrantedBy, governance: [governance] },
				grants: [governance],
			}),
		)
		renderAt("/admin")

		expect(
			screen.getByText("GCON...7890 · vault governance (1 of 2 signatures)"),
		).toBeTruthy()
	})

	it("adds one line when the signer lookup was unavailable", () => {
		useAdminAuthorityMock.mockReturnValue(
			authority({ status: "ready", signersUnknown: true }),
		)
		renderAt("/admin")

		expect(screen.getAllByText("Signer lookup unavailable.")).toHaveLength(1)
	})

	it("shows the cycle surface only on the Cycle tab", () => {
		const manager = holderOf("vault manager")
		const compliance = holderOf("share-token compliance")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["cycle", "compliance"]),
				grantedBy: {
					...emptyGrantedBy,
					cycle: [manager],
					compliance: [compliance],
				},
				grants: [manager, compliance],
			}),
		)
		renderAt("/admin/compliance")

		expect(screen.queryByText(/Cycle surface/)).toBeNull()

		fireEvent.click(screen.getByRole("link", { name: "Cycle" }))

		expect(screen.getAllByText(/Cycle surface/)).toHaveLength(1)
	})
})

import { render, screen, within } from "@testing-library/react"
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
				"GCON...7890 · vault manager · vault guardian · oracle guardian · vault governance",
			),
		).toBeTruthy()
	})

	it("names the signature standing on the identity line and on the cards", () => {
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
		render(<AdminPanel />)

		expect(
			screen.getByText(
				"GCON...7890 · oracle attester (1 of 2 signatures) · share-token compliance (weight 1 of threshold 3) · vault governance (signs alone)",
			),
		).toBeTruthy()
		expect(
			screen.getByText("Granted by vault governance — signs alone"),
		).toBeTruthy()
		expect(
			screen.getByText("Granted by oracle attester — 1 of 2 signatures"),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Granted by share-token compliance — weight 1 of threshold 3",
			),
		).toBeTruthy()
	})

	it("hands the Cycle card every grant that opened it, so its actions follow the wallet's roles", () => {
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
		render(<AdminPanel />)

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
		render(<AdminPanel />)

		expect(screen.getByText("Granted by vault manager")).toBeTruthy()
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
		render(<AdminPanel />)

		expect(
			screen.getByText("GCON...7890 · vault governance (1 of 2 signatures)"),
		).toBeTruthy()
	})

	it("adds one line when the signer lookup was unavailable", () => {
		useAdminAuthorityMock.mockReturnValue(
			authority({ status: "ready", signersUnknown: true }),
		)
		render(<AdminPanel />)

		expect(screen.getAllByText("Signer lookup unavailable.")).toHaveLength(1)
	})

	it("shows the cycle surface inside the Cycle card, and only there", () => {
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
		render(<AdminPanel />)

		const cards = screen.getAllByRole("listitem")
		const cycleCard = cards.find(
			(card) => within(card).queryByRole("heading", { name: "Cycle" }) !== null,
		)
		expect(
			within(cycleCard!).getByText("Cycle surface for vault manager"),
		).toBeTruthy()
		expect(screen.getAllByText(/Cycle surface/)).toHaveLength(1)
	})

	it("shows no cycle surface to a wallet with no Cycle grant", () => {
		const compliance = holderOf("share-token compliance")
		useAdminAuthorityMock.mockReturnValue(
			authority({
				status: "ready",
				surfaces: new Set(["compliance"]),
				grantedBy: { ...emptyGrantedBy, compliance: [compliance] },
				grants: [compliance],
			}),
		)
		render(<AdminPanel />)

		expect(screen.queryByText("Cycle surface")).toBeNull()
	})
})

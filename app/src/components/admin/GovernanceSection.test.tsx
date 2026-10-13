import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type Grant, type RoleHolders } from "../../hooks/useAdminAuthority"
import { type TransactionStatus } from "../../hooks/useContractTransaction"
import GovernanceSection from "./GovernanceSection"

const WALLET = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const ACCOUNT = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"
const VAULT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3"

const {
	grantVaultMock,
	revokeVaultMock,
	grantOracleMock,
	revokeOracleMock,
	grantTokenMock,
	revokeTokenMock,
} = vi.hoisted(() => {
	const tx = () => ({
		status: { status: "idle" } as { status: string },
		submit: vi.fn(() => true),
		reset: vi.fn(),
	})
	return {
		grantVaultMock: tx(),
		revokeVaultMock: tx(),
		grantOracleMock: tx(),
		revokeOracleMock: tx(),
		grantTokenMock: tx(),
		revokeTokenMock: tx(),
	}
})

vi.mock("../../hooks/useGovernanceTransactions", () => ({
	useGrantVaultRole: () => grantVaultMock,
	useRevokeVaultRole: () => revokeVaultMock,
	useGrantOracleRole: () => grantOracleMock,
	useRevokeOracleRole: () => revokeOracleMock,
	useGrantTokenRole: () => grantTokenMock,
	useRevokeTokenRole: () => revokeTokenMock,
}))
vi.mock("../../config/contracts", () => ({
	vaultContractId: "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3",
}))

const grantOf = (role: string): Grant => ({
	role,
	authority: WALLET,
	standing: "signs-alone",
})

const governance = grantOf("vault governance")
const tokenAdmin = grantOf("share-token admin")

const HOLDERS: RoleHolders = {
	"vault governance": [WALLET],
	"vault manager": [],
	"vault treasury": [],
	"vault guardian": [],
	"oracle attester": [ACCOUNT],
	"oracle guardian": [],
	"oracle admin": [WALLET],
	"share-token compliance": [],
	"share-token manager": [VAULT],
	"share-token admin": [WALLET],
}

const expand = (name: string) => {
	const toggle = screen
		.getAllByRole("button", { name })
		.find((candidate) => candidate.hasAttribute("aria-expanded"))
	if (toggle?.getAttribute("aria-expanded") === "false") fireEvent.click(toggle)
}

const submit = (name: string) =>
	screen
		.getAllByRole<HTMLButtonElement>("button", { name })
		.find((candidate) => !candidate.hasAttribute("aria-expanded"))!

const renderSection = (grants: Grant[], active = true) =>
	render(
		<GovernanceSection
			grants={grants}
			wallet={WALLET}
			holders={HOLDERS}
			active={active}
		/>,
	)

describe("GovernanceSection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		for (const mock of [
			grantVaultMock,
			revokeVaultMock,
			grantOracleMock,
			revokeOracleMock,
			grantTokenMock,
			revokeTokenMock,
		])
			Object.assign(mock, {
				status: { status: "idle" } as TransactionStatus,
				submit: vi.fn(() => true),
				reset: vi.fn(),
			})
	})

	it("shows the holders of every role grouped by contract", () => {
		renderSection([governance])

		const oracle = screen.getByRole("region", { name: "Oracle" })
		expect(within(oracle).getByText("Attester")).toBeTruthy()
		expect(within(oracle).getByText("GABA...EJXA")).toBeTruthy()
		const token = screen.getByRole("region", { name: "Share token" })
		expect(within(token).getByText("CABQ...GCK3")).toBeTruthy()
	})

	it("offers role changes only on the contracts the wallet administers", () => {
		renderSection([tokenAdmin])

		expect(
			screen.getAllByRole("button", { name: "Grant a share-token role" }),
		).toBeTruthy()
		expect(
			screen.queryAllByRole("button", { name: "Grant a vault role" }),
		).toEqual([])
	})

	it("grants the chosen role to the typed account", () => {
		renderSection([governance])

		expand("Grant a vault role")
		fireEvent.change(screen.getByRole("combobox", { name: "Role" }), {
			target: { value: "guardian" },
		})
		fireEvent.change(screen.getByRole("textbox", { name: "Account" }), {
			target: { value: ACCOUNT },
		})
		fireEvent.click(submit("Grant a vault role"))

		expect(grantVaultMock.submit).toHaveBeenCalledWith({
			role: "guardian",
			account: ACCOUNT,
		})
	})

	it("holds a dangerous revoke until its confirmation is checked", () => {
		renderSection([tokenAdmin])

		expand("Revoke a share-token role")
		fireEvent.change(screen.getByRole("combobox", { name: "Role" }), {
			target: { value: "manager" },
		})
		fireEvent.change(screen.getByRole("textbox", { name: "Account" }), {
			target: { value: VAULT },
		})

		expect(submit("Revoke a share-token role").disabled).toBe(true)
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Stops the vault minting and burning shares.",
			}),
		)
		expect(submit("Revoke a share-token role").disabled).toBe(false)
		fireEvent.click(submit("Revoke a share-token role"))
		expect(revokeTokenMock.submit).toHaveBeenCalledWith({
			role: "manager",
			account: VAULT,
		})
	})

	it("shows the running role change only while the tab is active", () => {
		grantOracleMock.status = { status: "awaiting-signature" }
		const { rerender } = renderSection([grantOf("oracle admin")])

		expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)
		rerender(
			<GovernanceSection
				grants={[grantOf("oracle admin")]}
				wallet={WALLET}
				holders={HOLDERS}
				active={false}
			/>,
		)
		expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0)
	})
})

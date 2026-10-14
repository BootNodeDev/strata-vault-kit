import { type PendingTransfer } from "@stellar-scaffold/app-lib"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import {
	type AdminAddresses,
	type Grant,
	type RoleHolders,
} from "../../hooks/useAdminAuthority"
import { type TransactionStatus } from "../../hooks/useContractTransaction"
import {
	type Handovers,
	type PendingUpgrade,
	type Upgrades,
} from "../../hooks/useGovernanceState"
import GovernanceSection from "./GovernanceSection"

const WALLET = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const ACCOUNT = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"
const VAULT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3"

const { txs, useGovernanceStateMock } = vi.hoisted(() => {
	const tx = (): {
		status: TransactionStatus
		submit: Mock<() => boolean>
		reset: Mock
	} => ({
		status: { status: "idle" },
		submit: vi.fn(() => true),
		reset: vi.fn(),
	})
	return {
		txs: {
			useGrantVaultRole: tx(),
			useRevokeVaultRole: tx(),
			useGrantOracleRole: tx(),
			useRevokeOracleRole: tx(),
			useGrantTokenRole: tx(),
			useRevokeTokenRole: tx(),
			useHandOverVaultAdmin: tx(),
			useCancelVaultHandover: tx(),
			useAcceptVaultAdmin: tx(),
			useHandOverOracleAdmin: tx(),
			useCancelOracleHandover: tx(),
			useAcceptOracleAdmin: tx(),
			useHandOverTokenAdmin: tx(),
			useCancelTokenHandover: tx(),
			useAcceptTokenAdmin: tx(),
			useProposeCodeUpgrade: tx(),
			useProposeUpgradeDelay: tx(),
			useApplyUpgrade: tx(),
			useCancelUpgrade: tx(),
			useProposeWindDown: tx(),
			useCancelWindDown: tx(),
		},
		useGovernanceStateMock: vi.fn(),
	}
})

vi.mock("../../hooks/useGovernanceTransactions", () =>
	Object.fromEntries(
		Object.entries(txs).map(([name, transaction]) => [name, () => transaction]),
	),
)
vi.mock("../../hooks/useGovernanceState", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useGovernanceState: useGovernanceStateMock,
}))
vi.mock("../../config/contracts", () => ({
	vaultContractId: "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3",
}))

const ADDRESSES: AdminAddresses = {
	oracle: "CORACLE",
	shareToken: "CTOKEN",
	identityVerifier: null,
}

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
	"identity-verifier admin": [],
	"share-token manager": [VAULT],
	"share-token admin": [WALLET],
	"vault pending admin": [],
	"oracle pending admin": [],
	"share-token pending admin": [],
}

const handovers = (pending: PendingTransfer | null = null): Handovers => ({
	status: "ready",
	ledger: { sequence: 1_000, closeTime: 1_700_000_000n, maxLiveUntil: null },
	pending: { vault: null, oracle: pending, token: null },
})

const upgrades = (proposal: PendingUpgrade | null = null): Upgrades => ({
	status: "ready",
	proposal,
	delay: 7n * 86_400n,
	notice: 86_400n,
	windDown: {
		phase: "proposed",
		activeAt: 1_700_100_000n,
		round: 0,
		delay: 86_400n,
		owed: null,
		supply: null,
	},
	now: 1_800_000_000n,
	paused: "open",
})

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
			addresses={ADDRESSES}
			active={active}
		/>,
	)

describe("GovernanceSection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useGovernanceStateMock.mockReturnValue({
			handovers: handovers(),
			upgrades: upgrades(),
		})
		for (const mock of Object.values(txs)) {
			mock.status = { status: "idle" }
			mock.submit = vi.fn(() => true)
			mock.reset = vi.fn()
		}
	})

	it("shows the holders of every role grouped by contract", () => {
		renderSection([governance])

		const oracle = screen.getByRole("region", { name: "Oracle" })
		expect(within(oracle).getByText("Attester")).toBeTruthy()
		expect(within(oracle).getByText("GABA...EJXA")).toBeTruthy()
		const token = screen.getByRole("region", { name: "Share token" })
		expect(within(token).getByText("CABQ...GCK3")).toBeTruthy()
	})

	it("says when the pending admins could not be read", () => {
		useGovernanceStateMock.mockReturnValue({
			handovers: { status: "unreadable" },
			upgrades: upgrades(),
		})
		renderSection([])

		expect(
			screen.getByText("Could not read the governance state."),
		).toBeTruthy()
	})

	it("keeps the rail checking while the pending admins load", () => {
		useGovernanceStateMock.mockReturnValue({
			handovers: { status: "checking" },
			upgrades: upgrades(),
		})
		renderSection([])

		expect(
			screen.queryByText("Could not read the governance state."),
		).toBeNull()
		expect(screen.queryByText("No actions available.")).toBeNull()
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

		expect(txs.useGrantVaultRole.submit).toHaveBeenCalledWith({
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
		expect(txs.useRevokeTokenRole.submit).toHaveBeenCalledWith({
			role: "manager",
			account: VAULT,
		})
	})

	it("asks again for a confirmation when a typed value comes back", () => {
		renderSection([governance])

		expand("Grant a vault role")
		fireEvent.change(screen.getByRole("combobox", { name: "Role" }), {
			target: { value: "guardian" },
		})
		const typeAccount = (value: string) =>
			fireEvent.change(screen.getByRole("textbox", { name: "Account" }), {
				target: { value },
			})
		const merge = () =>
			screen.getByRole<HTMLInputElement>("checkbox", {
				name: "Merges two vault roles on one account.",
			})
		typeAccount(WALLET)
		fireEvent.click(merge())
		expect(merge().checked).toBe(true)

		typeAccount(ACCOUNT)
		typeAccount(WALLET)

		expect(merge().checked).toBe(false)
		expect(submit("Grant a vault role").disabled).toBe(true)
	})

	it("asks again for a handover confirmation when the expiry comes back", () => {
		renderSection([governance])

		expand("Hand over vault admin")
		fireEvent.change(screen.getByRole("textbox", { name: "New admin" }), {
			target: { value: ACCOUNT },
		})
		const typeExpiry = (value: string) =>
			fireEvent.change(screen.getByRole("textbox", { name: "Expiry" }), {
				target: { value },
			})
		const hands = () =>
			screen.getByRole<HTMLInputElement>("checkbox", {
				name: "Hands control of the vault to GABA...EJXA.",
			})
		fireEvent.click(hands())
		typeExpiry("2d")
		typeExpiry("7d")

		expect(hands().checked).toBe(false)
	})

	it("shows the running role change only while the tab is active", () => {
		txs.useGrantOracleRole.status = { status: "awaiting-signature" }
		const { rerender } = renderSection([grantOf("oracle admin")])

		expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)
		rerender(
			<GovernanceSection
				grants={[grantOf("oracle admin")]}
				wallet={WALLET}
				holders={HOLDERS}
				addresses={ADDRESSES}
				active={false}
			/>,
		)
		expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0)
	})

	it("hands the admin over for the typed expiry once confirmed", () => {
		renderSection([governance])

		expand("Hand over vault admin")
		fireEvent.change(screen.getByRole("textbox", { name: "New admin" }), {
			target: { value: ACCOUNT },
		})
		fireEvent.change(screen.getByRole("textbox", { name: "Expiry" }), {
			target: { value: "2d" },
		})
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Hands control of the vault to GABA...EJXA.",
			}),
		)
		fireEvent.click(submit("Hand over vault admin"))

		expect(txs.useHandOverVaultAdmin.submit).toHaveBeenCalledWith({
			newAdmin: ACCOUNT,
			liveUntilLedger: 1_000 + 2 * 17_280,
		})
	})

	it("lets the pending wallet accept and the admin cancel", () => {
		useGovernanceStateMock.mockReturnValue({
			handovers: handovers({
				address: WALLET,
				liveUntilLedger: 5_000,
				expired: false,
			}),
			upgrades: upgrades(),
		})
		renderSection([grantOf("oracle admin"), grantOf("oracle pending admin")])

		expand("Accept oracle admin")
		fireEvent.click(submit("Accept oracle admin"))
		expand("Cancel the oracle handover")
		fireEvent.click(submit("Cancel the oracle handover"))

		expect(txs.useAcceptOracleAdmin.submit).toHaveBeenCalledWith(undefined)
		expect(txs.useCancelOracleHandover.submit).toHaveBeenCalledWith({
			newAdmin: WALLET,
			liveUntilLedger: 0,
		})
		expect(useGovernanceStateMock).toHaveBeenCalledWith({
			contracts: { vault: VAULT, oracle: "CORACLE", token: "CTOKEN" },
			active: true,
		})
	})

	it("applies a confirmed code upgrade and cancels the wind-down", () => {
		const hash = "ab".repeat(32)
		useGovernanceStateMock.mockReturnValue({
			handovers: handovers(),
			upgrades: upgrades({ kind: "code", hash, eta: 1_700_000_000n }),
		})
		renderSection([governance])

		expand("Apply the upgrade")
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `Replaces the vault's code with ${hash}.`,
			}),
		)
		fireEvent.click(submit("Apply the upgrade"))
		expand("Cancel the wind-down")
		fireEvent.click(submit("Cancel the wind-down"))

		expect(txs.useApplyUpgrade.submit).toHaveBeenCalledWith(undefined)
		expect(txs.useCancelWindDown.submit).toHaveBeenCalledWith(undefined)
		expect(screen.getByText("Pending upgrade")).toBeTruthy()
		expect(screen.getByTitle(`Code ${hash}`).textContent).toBe(
			"Code abab...abab",
		)
	})
})

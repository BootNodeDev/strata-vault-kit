import { act, fireEvent, render, screen, within } from "@testing-library/react"
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest"
import { type Grant } from "../../hooks/useAdminAuthority"
import { type TransactionStatus } from "../../hooks/useContractTransaction"
import ComplianceSection from "./ComplianceSection"

const { txs, useComplianceStateMock } = vi.hoisted(() => {
	const tx = (): {
		status: TransactionStatus
		submit: Mock<() => boolean>
		prepare: Mock
		reset: Mock
	} => ({
		status: { status: "idle" },
		submit: vi.fn(() => true),
		prepare: vi.fn(),
		reset: vi.fn(),
	})
	return {
		txs: {
			useAllowAddress: tx(),
			useDisallowAddress: tx(),
			useFreezeAddress: tx(),
			useUnfreezeAddress: tx(),
			useFreezeShares: tx(),
			useUnfreezeShares: tx(),
			useForceTransfer: tx(),
		},
		useComplianceStateMock: vi.fn(),
	}
})

vi.mock("../../hooks/useComplianceTransactions", () =>
	Object.fromEntries(
		Object.entries(txs).map(([name, transaction]) => [name, () => transaction]),
	),
)
vi.mock("../../hooks/useComplianceState", () => ({
	useComplianceState: useComplianceStateMock,
}))
vi.mock("../../config/contracts", () => ({
	vaultContractId: "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3",
}))

const VAULT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3"
const WALLET = "GWALLETADDRESS1234"
const TARGET = "GDPO5SQDJY4E2XEE47MAOT2M2F3GR4H2AYYKSMIOT2YPOHAMC36VKWIA"
const UNIT = 10_000_000n
const ADDRESSES = {
	oracle: "CORACLE",
	shareToken: "CTOKEN",
	identityVerifier: "CVERIFIERADDRESS",
}

const grantOf = (role: string): Grant => ({
	role,
	authority: WALLET,
	standing: "signs-alone",
})

const verifierAdmin = grantOf("identity-verifier admin")
const officer = grantOf("share-token compliance")

const openRow = (name: string) => {
	const toggle = screen
		.getAllByRole("button", { name })
		.find((candidate) => candidate.hasAttribute("aria-expanded"))
	if (toggle?.getAttribute("aria-expanded") === "false") fireEvent.click(toggle)
}

const button = (name: string) => {
	openRow(name)
	return screen
		.getAllByRole<HTMLButtonElement>("button", { name })
		.find((candidate) => !candidate.hasAttribute("aria-expanded"))!
}

const enterTarget = (text: string) =>
	fireEvent.change(screen.getByLabelText("Target address"), {
		target: { value: text },
	})

const readsFor = ({ target }: { target: string | undefined }) => ({
	target:
		target === undefined
			? { status: "none" }
			: {
					status: "ready",
					reads: {
						allowance: "not-allowed",
						frozen: false,
						shares: 100n * UNIT,
						frozenShares: 10n * UNIT,
					},
				},
	destination: "checking",
})

describe("ComplianceSection", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	beforeEach(() => {
		vi.clearAllMocks()
		for (const transaction of Object.values(txs))
			transaction.status = { status: "idle" }
		useComplianceStateMock.mockImplementation(readsFor)
	})

	it("blocks the actions until a target address is entered", () => {
		render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)

		expect(button("Freeze the address").disabled).toBe(true)
		expect(
			screen.getAllByText("Target address entered").length,
		).toBeGreaterThan(0)
	})

	it("reads the entered address and shows its state first", () => {
		render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)

		enterTarget(` ${TARGET} `)

		expect(useComplianceStateMock).toHaveBeenLastCalledWith({
			verifier: "CVERIFIERADDRESS",
			target: TARGET,
			destination: undefined,
		})
		const overview = screen.getByRole("region", { name: "Target" })
		expect(within(overview).getByText("Allowlisted")).toBeTruthy()
		expect(within(overview).getByText("90.00")).toBeTruthy()
	})

	it("tells the compliance role why the allowlist is unavailable", () => {
		render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
				verifierAdminUnknown
			/>,
		)
		enterTarget(TARGET)
		openRow("Allow the address")

		expect(button("Allow the address").disabled).toBe(true)
		expect(
			screen.getAllByText("Could not read the allowlist admin.").length,
		).toBeGreaterThan(0)
	})

	it("clears a vault confirmation when the target changes", () => {
		render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)
		enterTarget(VAULT)
		openRow("Freeze the address")
		fireEvent.click(screen.getByLabelText("Stops the vault moving shares."))
		expect(
			screen.getByLabelText<HTMLInputElement>("Stops the vault moving shares.")
				.checked,
		).toBe(true)

		enterTarget(TARGET)
		enterTarget(VAULT)

		expect(
			screen.getByLabelText<HTMLInputElement>("Stops the vault moving shares.")
				.checked,
		).toBe(false)
	})

	it("ignores an address that is not a valid key", () => {
		render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)

		enterTarget("GNOTANADDRESS")

		const input = screen.getByLabelText("Target address")
		expect(input.getAttribute("aria-invalid")).toBe("true")
		expect(input.getAttribute("aria-describedby")).toBe(
			screen.getByText("Enter a G… or C… address.").id,
		)
		expect(useComplianceStateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ target: undefined }),
		)
	})

	it("shows no address error for an empty or valid target", () => {
		render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)

		expect(screen.queryByText("Enter a G… or C… address.")).toBeNull()
		enterTarget(TARGET)
		expect(screen.queryByText("Enter a G… or C… address.")).toBeNull()
		expect(
			screen.getByLabelText("Target address").hasAttribute("aria-describedby"),
		).toBe(false)
	})

	it("prepares allowing the target once it settles and still submits it on click", () => {
		vi.useFakeTimers()
		render(
			<ComplianceSection
				grants={[verifierAdmin]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)
		enterTarget(TARGET)
		openRow("Allow the address")

		act(() => {
			vi.advanceTimersByTime(400)
		})

		const allowArg = { verifier: "CVERIFIERADDRESS", account: TARGET }
		expect(txs.useAllowAddress.prepare).toHaveBeenCalledWith(
			allowArg,
			verifierAdmin,
		)

		fireEvent.click(button("Allow the address"))

		expect(txs.useAllowAddress.submit).toHaveBeenCalledWith(
			allowArg,
			verifierAdmin,
		)
	})

	it("prepares nothing while the compliance tab is hidden", () => {
		vi.useFakeTimers()
		render(
			<ComplianceSection
				grants={[verifierAdmin]}
				wallet={WALLET}
				addresses={ADDRESSES}
				active={false}
			/>,
		)
		enterTarget(TARGET)
		openRow("Allow the address")

		act(() => {
			vi.advanceTimersByTime(400)
		})

		expect(txs.useAllowAddress.prepare).not.toHaveBeenCalled()
	})

	it("allows the target and follows it in the modal", () => {
		const { rerender } = render(
			<ComplianceSection
				grants={[verifierAdmin]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)
		enterTarget(TARGET)

		fireEvent.click(button("Allow the address"))
		expect(txs.useAllowAddress.submit).toHaveBeenCalledWith(
			{
				verifier: "CVERIFIERADDRESS",
				account: TARGET,
			},
			verifierAdmin,
		)

		txs.useAllowAddress.status = { status: "preparing" }
		rerender(
			<ComplianceSection
				grants={[verifierAdmin]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)
		expect(
			screen.getByRole("heading", { name: "Preparing to allow the address" }),
		).toBeTruthy()
	})

	it("freezes an amount of the target's shares", () => {
		render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
			/>,
		)
		enterTarget(TARGET)
		openRow("Freeze shares")

		const amount = document.getElementById(
			"compliance-freeze-shares-field-freeze-shares-amount",
		)
		fireEvent.change(amount!, { target: { value: "5" } })
		fireEvent.click(button("Freeze shares"))

		expect(txs.useFreezeShares.submit).toHaveBeenCalledWith(
			{
				account: TARGET,
				amount: 5n * UNIT,
			},
			officer,
		)
		expect(screen.getByText("Frozen shares 10.00 → 15.00.")).toBeTruthy()
	})

	it("shows the flow modal only while the surface is active", () => {
		txs.useFreezeAddress.status = { status: "preparing" }
		const { rerender } = render(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
				active
			/>,
		)
		expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)

		rerender(
			<ComplianceSection
				grants={[officer]}
				wallet={WALLET}
				addresses={ADDRESSES}
				active={false}
			/>,
		)
		expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0)
	})
})

import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type Grant } from "../../hooks/useAdminAuthority"
import { type TransactionStatus } from "../../hooks/useContractTransaction"
import EmergencySection from "./EmergencySection"

const transaction = () => ({
	status: { status: "idle" } as TransactionStatus,
	submit: vi.fn(() => true),
	reset: vi.fn(),
})

const {
	useVaultPausedMock,
	useTokenPausedMock,
	useOracleStateMock,
	pauseVaultMock,
	unpauseVaultMock,
	raiseRipcordMock,
	setRipcordMock,
	clearLatestMock,
	pauseTokenMock,
	unpauseTokenMock,
} = vi.hoisted(() => {
	const tx = () => ({
		status: { status: "idle" } as { status: string },
		submit: vi.fn(() => true),
		reset: vi.fn(),
	})
	return {
		useVaultPausedMock: vi.fn(),
		useTokenPausedMock: vi.fn(),
		useOracleStateMock: vi.fn(),
		pauseVaultMock: tx(),
		unpauseVaultMock: tx(),
		raiseRipcordMock: tx(),
		setRipcordMock: tx(),
		clearLatestMock: tx(),
		pauseTokenMock: tx(),
		unpauseTokenMock: tx(),
	}
})

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<object>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
}))
vi.mock("../../hooks/useVaultPaused", () => ({
	useVaultPaused: useVaultPausedMock,
}))
vi.mock("../../hooks/useTokenPaused", () => ({
	useTokenPaused: useTokenPausedMock,
}))
vi.mock("../../hooks/useOracleState", () => ({
	useOracleState: useOracleStateMock,
}))
vi.mock("../../hooks/useEmergencyTransactions", () => ({
	usePauseVault: () => pauseVaultMock,
	useUnpauseVault: () => unpauseVaultMock,
	useRaiseRipcord: () => raiseRipcordMock,
	useSetRipcord: () => setRipcordMock,
	useClearLatest: () => clearLatestMock,
	usePauseToken: () => pauseTokenMock,
	useUnpauseToken: () => unpauseTokenMock,
}))

const WALLET = "GWALLETADDRESS1234"

const grantOf = (role: string): Grant => ({
	role,
	authority: WALLET,
	standing: "signs-alone",
})

const guardian = grantOf("vault guardian")
const oracleAdmin = grantOf("oracle admin")
const tokenAdmin = grantOf("share-token admin")

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

const setState = (vault: string, token: string, oracle: string): void => {
	useVaultPausedMock.mockReturnValue({ pause: vault })
	useTokenPausedMock.mockReturnValue({ pause: token })
	useOracleStateMock.mockReturnValue({ oracle })
}

describe("EmergencySection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		for (const mock of [
			pauseVaultMock,
			unpauseVaultMock,
			raiseRipcordMock,
			setRipcordMock,
			clearLatestMock,
			pauseTokenMock,
			unpauseTokenMock,
		]) {
			Object.assign(mock, transaction())
		}
		setState("open", "open", "valid")
	})

	it("shows the vault, share token and oracle state first", () => {
		setState("paused", "open", "paused")
		render(<EmergencySection grants={[guardian]} wallet={WALLET} />)

		const overview = screen.getByRole("region", { name: "Status" })
		expect(within(overview).getByText("Vault")).toBeTruthy()
		expect(within(overview).getAllByText("Paused")).toHaveLength(2)
		expect(within(overview).getByText("Open")).toBeTruthy()
		expect(within(overview).getByText("Ripcord raised")).toBeTruthy()
	})

	it("offers the vault guardian only the pause, saying what it stops and what stays open", () => {
		render(<EmergencySection grants={[guardian]} wallet={WALLET} />)

		expect(button("Pause the vault").disabled).toBe(false)
		expect(
			screen.queryByRole("button", { name: "Unpause the vault", hidden: true }),
		).toBeNull()
		expect(
			screen.getByText(
				"Stops new deposits, pricing and upgrades. Redemptions, claims, cancels and closing epochs stay open.",
			),
		).toBeTruthy()
	})

	it("submits the vault pause and follows it in the modal", () => {
		const { rerender } = render(
			<EmergencySection grants={[guardian]} wallet={WALLET} />,
		)

		fireEvent.click(button("Pause the vault"))
		expect(pauseVaultMock.submit).toHaveBeenCalled()

		pauseVaultMock.status = { status: "preparing" }
		rerender(<EmergencySection grants={[guardian]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to pause the vault" }),
		).toBeTruthy()
	})

	it("raises the ripcord for an oracle admin through set_ripcord, shown as raising", () => {
		const { rerender } = render(
			<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />,
		)

		fireEvent.click(button("Raise the ripcord"))
		expect(setRipcordMock.submit).toHaveBeenCalledWith(true)
		expect(raiseRipcordMock.submit).not.toHaveBeenCalled()

		setRipcordMock.status = { status: "preparing" }
		rerender(<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to raise the ripcord" }),
		).toBeTruthy()
	})

	it("lowers the ripcord and clears the latest price once raised", () => {
		setState("open", "open", "paused")
		const { rerender } = render(
			<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />,
		)

		fireEvent.click(button("Lower the ripcord"))
		expect(setRipcordMock.submit).toHaveBeenCalledWith(false)

		setRipcordMock.status = { status: "preparing" }
		rerender(<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />)
		expect(
			screen.getByRole("heading", { name: "Preparing to lower the ripcord" }),
		).toBeTruthy()

		fireEvent.click(button("Clear the latest price"))
		expect(clearLatestMock.submit).toHaveBeenCalled()
	})

	it("holds the share-token unpause while the token is open", () => {
		render(<EmergencySection grants={[tokenAdmin]} wallet={WALLET} />)

		expect(button("Pause the share token").disabled).toBe(false)
		expect(button("Unpause the share token").disabled).toBe(true)
		fireEvent.click(button("Pause the share token"))
		expect(pauseTokenMock.submit).toHaveBeenCalled()
	})

	it("shows no actions while the state is still being read", () => {
		setState("checking", "open", "valid")
		render(<EmergencySection grants={[guardian]} wallet={WALLET} />)

		expect(
			screen.queryAllByRole("button", { name: "Pause the vault" }),
		).toHaveLength(0)
	})

	it("shows the flow modal only while the surface is active", () => {
		pauseVaultMock.status = { status: "preparing" }
		const { rerender } = render(
			<EmergencySection grants={[guardian]} wallet={WALLET} active />,
		)
		expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)

		rerender(
			<EmergencySection grants={[guardian]} wallet={WALLET} active={false} />,
		)
		expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0)
		expect(pauseVaultMock.reset).not.toHaveBeenCalled()
	})

	it("polls the state only while the surface is active", () => {
		const { rerender } = render(
			<EmergencySection grants={[guardian]} wallet={WALLET} active={false} />,
		)
		expect(useVaultPausedMock).toHaveBeenLastCalledWith({ poll: false })
		expect(useTokenPausedMock).toHaveBeenLastCalledWith({ poll: false })
		expect(useOracleStateMock).toHaveBeenLastCalledWith({ poll: false })

		rerender(<EmergencySection grants={[guardian]} wallet={WALLET} active />)
		expect(useVaultPausedMock).toHaveBeenLastCalledWith({ poll: true })
	})
})

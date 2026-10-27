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
	useSetupOpenMock,
	useTokenPausedMock,
	useOracleStateMock,
	pauseVaultMock,
	unpauseVaultMock,
	pauseNavMock,
	setNavPausedMock,
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
		useSetupOpenMock: vi.fn(),
		useTokenPausedMock: vi.fn(),
		useOracleStateMock: vi.fn(),
		pauseVaultMock: tx(),
		unpauseVaultMock: tx(),
		pauseNavMock: tx(),
		setNavPausedMock: tx(),
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
vi.mock("../../hooks/useSetupOpen", () => ({
	useSetupOpen: useSetupOpenMock,
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
	usePauseNav: () => pauseNavMock,
	useSetNavPaused: () => setNavPausedMock,
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
	useSetupOpenMock.mockReturnValue({ setup: "closed" })
	useTokenPausedMock.mockReturnValue({ pause: token })
	useOracleStateMock.mockReturnValue({ oracle })
}

describe("EmergencySection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		for (const mock of [
			pauseVaultMock,
			unpauseVaultMock,
			pauseNavMock,
			setNavPausedMock,
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
		expect(within(overview).getByText("NAV paused")).toBeTruthy()
	})

	it("shows whether setup is still open beside the vault", () => {
		useSetupOpenMock.mockReturnValue({ setup: "open" })
		render(<EmergencySection grants={[guardian]} wallet={WALLET} />)

		const overview = screen.getByRole("region", { name: "Status" })
		const tiles = within(overview).getAllByText(/^(Vault|Setup)$/)
		expect(tiles.map((tile) => tile.textContent)).toEqual(["Vault", "Setup"])
		expect(
			within(overview).getByText("Changes apply at once; no deposits yet"),
		).toBeTruthy()
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
		expect(pauseVaultMock.submit).toHaveBeenCalledWith(undefined, guardian)

		pauseVaultMock.status = { status: "preparing" }
		rerender(<EmergencySection grants={[guardian]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to pause the vault" }),
		).toBeTruthy()
	})

	it("pauses the NAV for an oracle admin through set_nav_paused, shown as pausing", () => {
		const { rerender } = render(
			<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />,
		)

		fireEvent.click(button("Pause the NAV"))
		expect(setNavPausedMock.submit).toHaveBeenCalledWith(true, oracleAdmin)
		expect(pauseNavMock.submit).not.toHaveBeenCalled()

		setNavPausedMock.status = { status: "preparing" }
		rerender(<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to pause the NAV" }),
		).toBeTruthy()
	})

	it("unpauses the NAV, and clears the latest price once paused", () => {
		setState("open", "open", "paused")
		const { rerender } = render(
			<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />,
		)

		fireEvent.click(button("Unpause the NAV"))
		expect(setNavPausedMock.submit).toHaveBeenCalledWith(false, oracleAdmin)

		setNavPausedMock.status = { status: "preparing" }
		rerender(<EmergencySection grants={[oracleAdmin]} wallet={WALLET} />)
		expect(
			screen.getByRole("heading", { name: "Preparing to unpause the NAV" }),
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

	it("keeps the actions available while the state is still being read", () => {
		setState("checking", "checking", "checking")
		render(<EmergencySection grants={[guardian]} wallet={WALLET} />)

		expect(button("Pause the vault").disabled).toBe(false)
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

	it("polls the vault pause state", () => {
		render(
			<EmergencySection grants={[guardian]} wallet={WALLET} active={false} />,
		)
		expect(useVaultPausedMock).toHaveBeenLastCalledWith({ poll: true })
	})
})

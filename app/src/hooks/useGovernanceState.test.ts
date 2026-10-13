import { Buffer } from "buffer"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { useGovernanceState } from "./useGovernanceState"

const {
	readPendingAdminsMock,
	vaultMock,
	useCycleReadsMock,
	useConfigurationStateMock,
	useVaultPausedMock,
} = vi.hoisted(() => ({
	readPendingAdminsMock: vi.fn(),
	vaultMock: { upgrade_proposal: vi.fn() },
	useCycleReadsMock: vi.fn(),
	useConfigurationStateMock: vi.fn(),
	useVaultPausedMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({ asyncVault: async () => vaultMock }))
vi.mock("./useCycleState", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useCycleReads: useCycleReadsMock,
}))
vi.mock("./useConfigurationState", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useConfigurationState: useConfigurationStateMock,
}))
vi.mock("./useVaultPaused", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useVaultPaused: useVaultPausedMock,
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	readPendingAdmins: readPendingAdminsMock,
}))

const VAULT = "CVAULT"
const ORACLE = "CORACLE"
const TOKEN = "CTOKEN"
const LEDGER = {
	sequence: 1_000,
	closeTime: 1_700_000_000n,
	maxLiveUntil: null,
}
const TRANSFER = { address: "GNEXT", liveUntilLedger: 2_000, expired: false }

const DAY = 86_400n
const WIND_DOWN = {
	phase: "none",
	activeAt: null,
	round: null,
	delay: DAY,
	owed: null,
	supply: null,
}

const render = () =>
	renderWithWallet(() =>
		useGovernanceState({
			contracts: { vault: VAULT, oracle: ORACLE, token: TOKEN },
		}),
	)

describe("useGovernanceState", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		readPendingAdminsMock.mockResolvedValue({ kind: "unreadable" })
		vaultMock.upgrade_proposal.mockResolvedValue({ result: null })
		useCycleReadsMock.mockReturnValue({
			ledgerTime: 1_800_000_000n,
			windDown: WIND_DOWN,
		})
		useConfigurationStateMock.mockReturnValue({
			configuration: {
				status: "ready",
				upgradeDelay: 7n * DAY,
				notice: DAY,
			},
		})
		useVaultPausedMock.mockReturnValue({ pause: "open" })
	})

	it("files each contract's pending transfer under its own name", async () => {
		readPendingAdminsMock.mockResolvedValue({
			kind: "value",
			value: {
				ledger: LEDGER,
				pending: new Map([
					[VAULT, null],
					[ORACLE, TRANSFER],
					[TOKEN, null],
				]),
			},
		})
		const { result } = render()

		await waitFor(() => expect(result.current.handovers.status).toBe("ready"))
		expect(readPendingAdminsMock).toHaveBeenCalledWith([VAULT, ORACLE, TOKEN])
		expect(result.current.handovers).toEqual({
			status: "ready",
			ledger: LEDGER,
			pending: { vault: null, oracle: TRANSFER, token: null },
		})
	})

	it("reports unreadable when the ledger cannot be read", async () => {
		readPendingAdminsMock.mockResolvedValue({ kind: "unreadable" })
		const { result } = render()

		await waitFor(() =>
			expect(result.current.handovers.status).toBe("unreadable"),
		)
	})

	it("gathers the upgrade delay, notice, wind-down, ledger time and pause", async () => {
		const { result } = render()

		await waitFor(() => expect(result.current.upgrades.status).toBe("ready"))
		expect(result.current.upgrades).toEqual({
			status: "ready",
			proposal: null,
			delay: 7n * DAY,
			notice: DAY,
			windDown: WIND_DOWN,
			now: 1_800_000_000n,
			paused: "open",
		})
	})

	it.each([
		[
			{ action: { tag: "Wasm", values: [Buffer.alloc(32, 0xab)] }, eta: 5n },
			{ kind: "code", hash: "ab".repeat(32), eta: 5n },
		],
		[
			{ action: { tag: "Delay", values: [14n * DAY] }, eta: 5n },
			{ kind: "delay", secs: 14n * DAY, eta: 5n },
		],
	])("decodes a pending upgrade proposal", async (raw, proposal) => {
		vaultMock.upgrade_proposal.mockResolvedValue({ result: raw })
		const { result } = render()

		await waitFor(() => expect(result.current.upgrades.status).toBe("ready"))
		expect(result.current.upgrades).toMatchObject({ proposal })
	})

	it("keeps an unreadable proposal unknown and waits for the configuration", async () => {
		vaultMock.upgrade_proposal.mockRejectedValue(new Error("down"))
		const { result, rerender } = render()

		await waitFor(() => expect(result.current.upgrades.status).toBe("ready"))
		expect(result.current.upgrades).toMatchObject({ proposal: undefined })

		useConfigurationStateMock.mockReturnValue({
			configuration: { status: "checking" },
		})
		rerender()
		expect(result.current.upgrades).toEqual({ status: "checking" })
	})
})

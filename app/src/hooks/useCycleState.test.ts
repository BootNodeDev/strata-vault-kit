import type * as AppLib from "@stellar-scaffold/app-lib"
import {
	type Amount,
	type ContractRead,
	type EpochInfo,
	type NavReport,
	type OracleState,
	type Price,
} from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import {
	toEpoch,
	toOracle,
	toWindDown,
	useCycleEvents,
	useCycleState,
} from "./useCycleState"
import { type EpochHistoryRead, type EpochRecord } from "./useEpochHistory"

const { vaultMock, oracleMock, assetMock, readEpochsMock, readEventsMock } =
	vi.hoisted(() => ({
		vaultMock: {
			current_epoch: vi.fn(),
			notice: vi.fn(),
			free_reserve: vi.fn(),
			deposit_cap: vi.fn(),
			wind_down: vi.fn(),
			wind_down_delay: vi.fn(),
			wind_down_owed: vi.fn(),
			wind_down_supply: vi.fn(),
			liquid_reserve: vi.fn(),
			committed: vi.fn(),
			uncovered: vi.fn(),
			total_economic_supply: vi.fn(),
			net_deployed: vi.fn(),
			paused: vi.fn(),
			governance: vi.fn(),
			manager: vi.fn(),
			treasury: vi.fn(),
			guardian: vi.fn(),
			custodian: vi.fn(),
		},
		oracleMock: { state: vi.fn(), latest: vi.fn(), config: vi.fn() },
		assetMock: { balance: vi.fn() },
		readEpochsMock: vi.fn(),
		readEventsMock: vi.fn(),
	}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => vaultMock,
	navOracle: async () => oracleMock,
	asset: async () => assetMock,
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	readEpochs: readEpochsMock,
	readEvents: readEventsMock,
	readLedgerTime: async () => 1_700_100_000n,
}))

const value = <T>(result: T): ContractRead<T> => ({
	kind: "value",
	value: result,
})
const unreadable = { kind: "unreadable" } as const

const report: NavReport = {
	expires_at: 1_700_136_000n,
	nav_per_share: 10n ** 18n,
	timestamp: 1_700_050_000n,
}

const config = {
	freshness_duration: 86_400n,
	cooldown_secs: 3_600n,
	max_up_bps: 500,
	max_down_bps: null,
	min_answer: 5n * 10n ** 17n,
	max_answer: 2n * 10n ** 18n,
}

const state = (tag: OracleState["tag"]): ContractRead<OracleState> =>
	value({ tag, values: undefined } as OracleState)

describe("toOracle", () => {
	it("carries the report, the limits and no ripcord while the price is valid", () => {
		expect(toOracle(state("Valid"), value(report), value(config))).toEqual({
			state: "valid",
			price: (10n ** 18n) as Price,
			attestedAt: 1_700_050_000n,
			expiresAt: 1_700_136_000n,
			ripcord: false,
			limits: {
				freshness: 86_400n,
				cooldown: 3_600n,
				maxUpBps: 500,
				maxDownBps: null,
				min: 5n * 10n ** 17n,
				max: 2n * 10n ** 18n,
			},
		})
	})

	it("keeps the last report while the price is stale", () => {
		const oracle = toOracle(state("Stale"), value(report), value(config))

		expect(oracle.state).toBe("stale")
		expect(oracle.expiresAt).toBe(1_700_136_000n)
	})

	it("reads a paused oracle as a raised ripcord", () => {
		expect(
			toOracle(state("Paused"), value(report), value(config)).ripcord,
		).toBe(true)
	})

	it("has no price when nothing was ever attested", () => {
		const oracle = toOracle(
			state("Stale"),
			{ kind: "contract-error", code: 3006 },
			value(config),
		)

		expect(oracle).toMatchObject({
			state: "never",
			price: null,
			attestedAt: null,
			expiresAt: null,
		})
	})

	it("reports nothing it could not read", () => {
		expect(toOracle(unreadable, unreadable, unreadable)).toEqual({
			state: "unreadable",
			price: null,
			attestedAt: null,
			expiresAt: null,
			ripcord: null,
			limits: null,
		})
	})
})

describe("toWindDown", () => {
	const none = value(null)

	it.each([
		["no proposal", none, "none"],
		[
			"a proposal",
			value({ active_at: 5n, round: 0, status: { tag: "Proposed" as const } }),
			"proposed",
		],
		[
			"an active wind-down",
			value({ active_at: 5n, round: 2, status: { tag: "Active" as const } }),
			"active",
		],
		["an unreadable proposal", unreadable, null],
	])("reads %s as %s", (_name, proposal, phase) => {
		expect(toWindDown(proposal, value(60n), value(7n), value(9n)).phase).toBe(
			phase,
		)
	})

	it("carries the delay, what is owed and the supply", () => {
		expect(toWindDown(none, value(60n), value(7n), value(9n))).toMatchObject({
			delay: 60n,
			owed: 7n,
			supply: 9n,
		})
	})
})

const record = (id: bigint, status: EpochRecord["status"]): EpochRecord => ({
	id,
	status,
	totalDeposited: 0n as Amount,
	totalSharesRedeeming: 0n as Amount,
	sharePrice: null,
	closedAt: 0n,
	priceableAt: 0n,
})

describe("toEpoch", () => {
	const loaded = (
		epochs: EpochRecord[],
		unreadableIds: bigint[] = [],
	): Extract<EpochHistoryRead, { status: "loaded" }> => ({
		status: "loaded",
		currentEpoch: 4n,
		epochs,
		absent: [],
		unreadable: unreadableIds,
	})

	it("takes the open epoch and the oldest sealed one still awaiting a price", () => {
		const epoch = toEpoch(
			loaded([
				record(4n, "Open"),
				record(3n, "Pending"),
				record(2n, "Pending"),
				record(1n, "Fulfilled"),
			]),
			value(3_600n),
		)

		expect(epoch.id).toBe(4n)
		expect(epoch.open?.id).toBe(4n)
		expect(epoch.awaiting?.id).toBe(2n)
		expect(epoch.awaitingKnown).toBe(true)
		expect(epoch.noticeSeconds).toBe(3_600n)
	})

	it("has nothing awaiting when every sealed epoch is priced", () => {
		const epoch = toEpoch(
			loaded([record(4n, "Open"), record(3n, "Fulfilled")]),
			unreadable,
		)

		expect(epoch.awaiting).toBeNull()
		expect(epoch.noticeSeconds).toBeNull()
	})

	it("cannot rule out a sealed epoch when one was unreadable", () => {
		expect(
			toEpoch(loaded([record(4n, "Open")], [3n]), value(0n)).awaitingKnown,
		).toBe(false)
	})
})

const epochInfo = (status: EpochInfo["status"]["tag"]): EpochInfo => ({
	status: { tag: status, values: undefined },
	total_deposited: 100n,
	total_shares_redeeming: 0n,
	share_price: 0n,
	closed_at: 0n,
	priceable_at: 0n,
})

const resolveVault = () => {
	vaultMock.current_epoch.mockResolvedValue({ result: 2n })
	vaultMock.notice.mockResolvedValue({ result: 3_600n })
	vaultMock.free_reserve.mockResolvedValue({ result: 900n })
	vaultMock.deposit_cap.mockResolvedValue({ result: null })
	vaultMock.wind_down.mockResolvedValue({ result: null })
	vaultMock.wind_down_delay.mockResolvedValue({ result: 60n })
	vaultMock.wind_down_owed.mockResolvedValue({ result: 0n })
	vaultMock.wind_down_supply.mockResolvedValue({ result: 0n })
	vaultMock.liquid_reserve.mockResolvedValue({ result: 800n })
	vaultMock.committed.mockResolvedValue({ result: 100n })
	vaultMock.uncovered.mockResolvedValue({ result: 0n })
	vaultMock.total_economic_supply.mockResolvedValue({ result: 1_000n })
	vaultMock.net_deployed.mockResolvedValue({ result: 200n })
	vaultMock.paused.mockResolvedValue({ result: false })
	vaultMock.governance.mockResolvedValue({ result: "GGOVERNANCE" })
	vaultMock.manager.mockResolvedValue({ result: "GMANAGER" })
	vaultMock.treasury.mockResolvedValue({ result: "GTREASURY" })
	vaultMock.guardian.mockResolvedValue({ result: "GGUARDIAN" })
	vaultMock.custodian.mockResolvedValue({ result: "GCUSTODIAN" })
	oracleMock.state.mockResolvedValue({ result: { tag: "Valid" } })
	oracleMock.latest.mockResolvedValue({ result: report })
	oracleMock.config.mockResolvedValue({ result: config })
	assetMock.balance.mockResolvedValue({ result: 150n })
	readEpochsMock.mockResolvedValue(
		new Map([
			[1n, value(epochInfo("Pending"))],
			[2n, value(epochInfo("Open"))],
		]),
	)
}

describe("deposit cap", () => {
	it("reads null as no cap, not as a failed read", async () => {
		resolveVault()
		vaultMock.deposit_cap.mockResolvedValue({ result: null })

		const { result: hook } = renderWithWallet(useCycleState)
		await waitFor(() => expect(hook.current.cycle.status).toBe("ready"))

		expect(hook.current.cycle).toMatchObject({
			reserve: { depositCap: { kind: "uncapped" } },
		})
	})

	it("leaves a failed read as unavailable", async () => {
		resolveVault()
		vaultMock.deposit_cap.mockRejectedValue(new Error("network down"))

		const { result: hook } = renderWithWallet(useCycleState)
		await waitFor(() => expect(hook.current.cycle.status).toBe("ready"))

		expect(hook.current.cycle).toMatchObject({ reserve: { depositCap: null } })
	})
})

describe("useCycleState", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resolveVault()
	})

	it("is checking until every read has landed, then ready with the composed state", async () => {
		const { result } = renderWithWallet(useCycleState)

		expect(result.current.cycle).toEqual({ status: "checking" })
		await waitFor(() => expect(result.current.cycle.status).toBe("ready"))

		expect(result.current.cycle).toMatchObject({
			status: "ready",
			ledgerTime: 1_700_100_000n,
			paused: "open",
			epoch: { id: 2n, awaiting: { id: 1n }, noticeSeconds: 3_600n },
			oracle: { state: "valid" },
			reserve: {
				free: 900n,
				committed: 100n,
				uncovered: 0n,
				liquid: 800n,
				netDeployed: 200n,
				depositCap: { kind: "uncapped" },
				custodian: "GCUSTODIAN",
				custodianBalance: 150n,
			},
			windDown: { phase: "none", delay: 60n },
		})
		expect(assetMock.balance).toHaveBeenCalledWith({ id: "GCUSTODIAN" })
	})

	it("refetches the cycle reads while the page stays open", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		try {
			const { result } = renderWithWallet(useCycleState)
			await waitFor(() => expect(result.current.cycle.status).toBe("ready"))
			const before = oracleMock.state.mock.calls.length

			await vi.advanceTimersByTimeAsync(16_000)

			expect(oracleMock.state.mock.calls.length).toBeGreaterThan(before)
		} finally {
			vi.useRealTimers()
		}
	})

	it("reads no balance when no custodian is set", async () => {
		vaultMock.custodian.mockResolvedValue({ result: null })

		const { result } = renderWithWallet(useCycleState)
		await waitFor(() => expect(result.current.cycle.status).toBe("ready"))

		expect(result.current.cycle).toMatchObject({
			reserve: { custodian: null, custodianBalance: null },
		})
		expect(assetMock.balance).not.toHaveBeenCalled()
	})

	it("is unreadable when the vault cannot be reached", async () => {
		vaultMock.current_epoch.mockRejectedValue(new Error("network down"))

		const { result } = renderWithWallet(useCycleState)

		await waitFor(() =>
			expect(result.current.cycle).toEqual({ status: "unreadable" }),
		)
	})
})

describe("useCycleEvents", () => {
	beforeEach(() => {
		readEventsMock.mockReset()
	})

	it("asks for the vault and oracle events over the last seven days of ledgers", async () => {
		readEventsMock.mockResolvedValue({
			kind: "value",
			value: [],
			partial: false,
		})

		const { result } = renderWithWallet(useCycleEvents)
		await waitFor(() =>
			expect(result.current.cycleEvents).toEqual({
				status: "loaded",
				events: [],
				partial: false,
			}),
		)

		const [selections, windowLedgers] = readEventsMock.mock.calls[0] as [
			{ names: string[] }[],
			number,
		]
		expect(selections.flatMap((selection) => selection.names)).toEqual([
			"epoch_closed",
			"epoch_fulfilled",
			"deposit_requested",
			"deposit_claimed",
			"nav_attested",
		])
		expect(windowLedgers).toBe(120_960)
	})

	it("carries the partial flag when the events were capped", async () => {
		readEventsMock.mockResolvedValue({
			kind: "value",
			value: [],
			partial: true,
		})

		const { result } = renderWithWallet(useCycleEvents)

		await waitFor(() =>
			expect(result.current.cycleEvents).toMatchObject({
				status: "loaded",
				partial: true,
			}),
		)
	})

	it("is unreadable when the RPC cannot serve the events", async () => {
		readEventsMock.mockResolvedValue(unreadable)

		const { result } = renderWithWallet(useCycleEvents)

		await waitFor(() =>
			expect(result.current.cycleEvents).toEqual({ status: "unreadable" }),
		)
	})
})

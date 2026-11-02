import {
	type ContractRead,
	type EpochInfo,
	type Price,
} from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { fetchEpochHistory, useEpochHistory } from "./useEpochHistory"

const { vaultMock, asyncVaultMock, readEpochsMock } = vi.hoisted(() => ({
	vaultMock: { current_epoch: vi.fn() },
	asyncVaultMock: vi.fn(),
	readEpochsMock: vi.fn(),
}))
asyncVaultMock.mockResolvedValue(vaultMock)

vi.mock("../config/clients", () => ({ asyncVault: asyncVaultMock }))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	readEpochs: readEpochsMock,
}))

const fulfilled: EpochInfo = {
	status: { tag: "Fulfilled", values: undefined },
	total_deposited: 200_0000000n,
	total_shares_redeeming: 20_0000000n,
	share_price: 1_500_000_000_000_000_000n,
	closed_at: 1_700_000_000n,
	priceable_at: 1_700_003_600n,
}

const pending: EpochInfo = {
	status: { tag: "Pending", values: undefined },
	total_deposited: 50_0000000n,
	total_shares_redeeming: 0n,
	share_price: 0n,
	closed_at: 1_700_010_000n,
	priceable_at: 1_700_013_600n,
}

const open: EpochInfo = {
	status: { tag: "Open", values: undefined },
	total_deposited: 10_0000000n,
	total_shares_redeeming: 5_0000000n,
	share_price: 0n,
	closed_at: 0n,
	priceable_at: 0n,
}

const present = (epoch: EpochInfo): ContractRead<EpochInfo | null> => ({
	kind: "value",
	value: epoch,
})

const readsOf = (entries: [bigint, ContractRead<EpochInfo | null>][]) =>
	new Map(entries)

const currentEpochIs = (epoch: bigint) =>
	vaultMock.current_epoch.mockResolvedValue({ result: epoch })

describe("fetchEpochHistory", () => {
	beforeEach(() => {
		vaultMock.current_epoch.mockReset()
		readEpochsMock.mockReset()
	})

	it("lists epochs newest first with the price only on a fulfilled one", async () => {
		currentEpochIs(3n)
		readEpochsMock.mockResolvedValue(
			readsOf([
				[1n, present(fulfilled)],
				[2n, present(pending)],
				[3n, present(open)],
			]),
		)

		const history = await fetchEpochHistory()

		expect(history).toEqual({
			status: "loaded",
			currentEpoch: 3n,
			epochs: [
				{
					id: 3n,
					status: "Open",
					totalDeposited: 10_0000000n,
					totalSharesRedeeming: 5_0000000n,
					sharePrice: null,
					closedAt: 0n,
					priceableAt: 0n,
				},
				{
					id: 2n,
					status: "Pending",
					totalDeposited: 50_0000000n,
					totalSharesRedeeming: 0n,
					sharePrice: null,
					closedAt: 1_700_010_000n,
					priceableAt: 1_700_013_600n,
				},
				{
					id: 1n,
					status: "Fulfilled",
					totalDeposited: 200_0000000n,
					totalSharesRedeeming: 20_0000000n,
					sharePrice: 1_500_000_000_000_000_000n as Price,
					closedAt: 1_700_000_000n,
					priceableAt: 1_700_003_600n,
				},
			],
			absent: [],
			unreadable: [],
		})
		expect(readEpochsMock).toHaveBeenCalledWith(expect.any(String), [
			1n,
			2n,
			3n,
		])
	})

	it("reports an archived epoch as absent and keeps the rest", async () => {
		currentEpochIs(2n)
		readEpochsMock.mockResolvedValue(
			readsOf([
				[1n, { kind: "archived" }],
				[2n, present(open)],
			]),
		)

		const history = await fetchEpochHistory()

		expect(history.status === "loaded" && history.absent).toEqual([1n])
		expect(
			history.status === "loaded" && history.epochs.map((epoch) => epoch.id),
		).toEqual([2n])
	})

	it("reports an epoch that cannot be read, and one with no entry, as unreadable", async () => {
		currentEpochIs(3n)
		readEpochsMock.mockResolvedValue(
			readsOf([
				[1n, { kind: "unreadable" }],
				[2n, { kind: "value", value: null }],
				[3n, present(open)],
			]),
		)

		const history = await fetchEpochHistory()

		expect(history.status === "loaded" && history.unreadable).toEqual([1n, 2n])
	})

	it("reads every epoch of a long history in one call", async () => {
		currentEpochIs(70n)
		readEpochsMock.mockResolvedValue(new Map())

		await fetchEpochHistory()

		const [, epochIds] = readEpochsMock.mock.calls[0] as [string, bigint[]]
		expect(epochIds).toHaveLength(70)
		expect(epochIds[0]).toBe(1n)
		expect(epochIds[69]).toBe(70n)
	})

	it("is unreadable when the current epoch cannot be read, with no ledger call", async () => {
		vaultMock.current_epoch.mockRejectedValue(new Error("network down"))

		const history = await fetchEpochHistory()

		expect(history).toEqual({ status: "unreadable" })
		expect(readEpochsMock).not.toHaveBeenCalled()
	})
})

describe("useEpochHistory", () => {
	beforeEach(() => {
		vaultMock.current_epoch.mockReset()
		readEpochsMock.mockReset()
	})

	it("is checking until the read lands, then loaded", async () => {
		currentEpochIs(1n)
		readEpochsMock.mockResolvedValue(readsOf([[1n, present(open)]]))

		const { result } = renderWithWallet(useEpochHistory)

		expect(result.current.history).toEqual({ status: "checking" })
		await waitFor(() => expect(result.current.history.status).toBe("loaded"))
	})
})

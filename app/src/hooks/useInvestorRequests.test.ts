import {
	type Amount,
	type ContractRead,
	type DepositRequest,
	type EpochInfo,
	type EpochRequestsRead,
	type Price,
	type RedeemRequest,
	networkPassphrase,
} from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { addresses } from "../config/addresses"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
import {
	classifyRequest,
	fetchInvestorRequests,
	investorRequestsKey,
	useInvestorRequests,
} from "./useInvestorRequests"

const { vaultMock, asyncVaultMock, readEpochRequestsMock } = vi.hoisted(() => ({
	vaultMock: {
		current_epoch: vi.fn(),
	},
	asyncVaultMock: vi.fn(),
	readEpochRequestsMock: vi.fn(),
}))
asyncVaultMock.mockResolvedValue(vaultMock)

vi.mock("../config/clients", () => ({
	asyncVault: asyncVaultMock,
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	readEpochRequests: readEpochRequestsMock,
}))

const controller = "GCONTROLLER1234567890"

const openEpoch: EpochInfo = {
	status: { tag: "Open", values: undefined },
	total_deposited: 100_0000000n,
	total_shares_redeeming: 0n,
	share_price: 0n,
	closed_at: 0n,
	priceable_at: 0n,
}

const pendingEpoch: EpochInfo = {
	status: { tag: "Pending", values: undefined },
	total_deposited: 0n,
	total_shares_redeeming: 50_0000000n,
	share_price: 0n,
	closed_at: 1_700_000_000n,
	priceable_at: 1_700_003_600n,
}

const fulfilledEpoch: EpochInfo = {
	status: { tag: "Fulfilled", values: undefined },
	total_deposited: 200_0000000n,
	total_shares_redeeming: 20_0000000n,
	share_price: 1_500_000_000_000_000_000n,
	closed_at: 1_700_000_000n,
	priceable_at: 1_700_003_600n,
}

const depositPresent: ContractRead<DepositRequest | null> = {
	kind: "value",
	value: { amount: 100_0000000n, claimed: false },
}
const depositClaimed: ContractRead<DepositRequest | null> = {
	kind: "value",
	value: { amount: 100_0000000n, claimed: true },
}
const depositAbsent: ContractRead<DepositRequest | null> = {
	kind: "value",
	value: null,
}
const depositUnreadable: ContractRead<DepositRequest | null> = {
	kind: "unreadable",
}
const depositArchived: ContractRead<DepositRequest | null> = {
	kind: "archived",
}

const redeemPresent: ContractRead<RedeemRequest | null> = {
	kind: "value",
	value: { shares: 20_0000000n, claimed: false },
}

const redeemAbsent: ContractRead<RedeemRequest | null> = {
	kind: "value",
	value: null,
}

describe("classifyRequest", () => {
	it("classifies a present request", () => {
		expect(classifyRequest(depositPresent, "deposit", 1n, openEpoch)).toEqual({
			kind: "present",
			request: {
				epochId: 1n,
				side: "deposit",
				epochStatus: openEpoch.status,
				sharePrice: openEpoch.share_price as Price,
				amount: 100_0000000n as Amount,
				claimed: false,
				priceableAt: openEpoch.priceable_at,
			},
		})
	})

	it("classifies a claimed request", () => {
		expect(
			classifyRequest(depositClaimed, "deposit", 3n, fulfilledEpoch),
		).toEqual({
			kind: "present",
			request: {
				epochId: 3n,
				side: "deposit",
				epochStatus: fulfilledEpoch.status,
				sharePrice: fulfilledEpoch.share_price as Price,
				amount: 100_0000000n as Amount,
				claimed: true,
				priceableAt: fulfilledEpoch.priceable_at,
			},
		})
	})

	it("classifies a redeem request, reading shares rather than amount", () => {
		expect(
			classifyRequest(redeemPresent, "redeem", 3n, fulfilledEpoch),
		).toEqual({
			kind: "present",
			request: {
				epochId: 3n,
				side: "redeem",
				epochStatus: fulfilledEpoch.status,
				sharePrice: fulfilledEpoch.share_price as Price,
				amount: 20_0000000n as Amount,
				claimed: false,
				priceableAt: fulfilledEpoch.priceable_at,
			},
		})
	})

	it("classifies a genuine absence distinctly from a failed read", () => {
		expect(classifyRequest(depositAbsent, "deposit", 2n, pendingEpoch)).toEqual(
			{ kind: "absent" },
		)
	})

	it("classifies a failed read distinctly from an absence", () => {
		expect(
			classifyRequest(depositUnreadable, "deposit", 2n, pendingEpoch),
		).toEqual({
			kind: "unreadable",
			request: { epochId: 2n, side: "deposit" },
		})
	})

	it("classifies an archived entry distinctly from both absence and failure", () => {
		expect(
			classifyRequest(depositArchived, "deposit", 2n, pendingEpoch),
		).toEqual({
			kind: "archived",
			request: {
				epochId: 2n,
				side: "deposit",
				epochStatus: pendingEpoch.status,
				sharePrice: pendingEpoch.share_price as Price,
			},
		})
	})
})

describe("fetchInvestorRequests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultMock.mockResolvedValue(vaultMock)
	})

	it("walks every epoch, skipping a gap without stopping", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 3n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "value", value: openEpoch },
						deposit: {
							kind: "value",
							value: { amount: 100_0000000n, claimed: false },
						},
						redeem: redeemAbsent,
					},
				],
				[
					2n,
					{
						epoch: { kind: "value", value: pendingEpoch },
						deposit: depositAbsent,
						redeem: redeemAbsent,
					},
				],
				[
					3n,
					{
						epoch: { kind: "value", value: fulfilledEpoch },
						deposit: {
							kind: "value",
							value: { amount: 50_0000000n, claimed: true },
						},
						redeem: {
							kind: "value",
							value: { shares: 20_0000000n, claimed: false },
						},
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [
				{
					epochId: 1n,
					side: "deposit",
					epochStatus: openEpoch.status,
					sharePrice: openEpoch.share_price as Price,
					amount: 100_0000000n as Amount,
					claimed: false,
					priceableAt: openEpoch.priceable_at,
				},
				{
					epochId: 3n,
					side: "deposit",
					epochStatus: fulfilledEpoch.status,
					sharePrice: fulfilledEpoch.share_price as Price,
					amount: 50_0000000n as Amount,
					claimed: true,
					priceableAt: fulfilledEpoch.priceable_at,
				},
				{
					epochId: 3n,
					side: "redeem",
					epochStatus: fulfilledEpoch.status,
					sharePrice: fulfilledEpoch.share_price as Price,
					amount: 20_0000000n as Amount,
					claimed: false,
					priceableAt: fulfilledEpoch.priceable_at,
				},
			],
			archived: [],
			unreadable: [],
		})
		expect(readEpochRequestsMock).toHaveBeenCalledWith(
			addresses.async_vault,
			controller,
			[1n, 2n, 3n],
		)
	})

	it("collects an archived entry separately, never as absent or merged into requests", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 1n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "value", value: openEpoch },
						deposit: depositArchived,
						redeem: redeemAbsent,
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [],
			archived: [
				{
					epochId: 1n,
					side: "deposit",
					epochStatus: openEpoch.status,
					sharePrice: openEpoch.share_price as Price,
				},
			],
			unreadable: [],
		})
	})

	it("renders a live current-epoch request while an older epoch's read is unreadable", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 2n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "unreadable" },
						deposit: depositAbsent,
						redeem: redeemAbsent,
					},
				],
				[
					2n,
					{
						epoch: { kind: "value", value: pendingEpoch },
						deposit: depositAbsent,
						redeem: {
							kind: "value",
							value: { shares: 30_0000000n, claimed: false },
						},
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [
				{
					epochId: 2n,
					side: "redeem",
					epochStatus: pendingEpoch.status,
					sharePrice: pendingEpoch.share_price as Price,
					amount: 30_0000000n as Amount,
					claimed: false,
					priceableAt: pendingEpoch.priceable_at,
				},
			],
			archived: [],
			unreadable: [
				{ epochId: 1n, side: "deposit" },
				{ epochId: 1n, side: "redeem" },
			],
		})
	})

	it("leaves no trace when an older epoch's own read is archived, fixing the Blocked-tab defect", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 2n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "archived" },
						deposit: depositAbsent,
						redeem: redeemAbsent,
					},
				],
				[
					2n,
					{
						epoch: { kind: "value", value: pendingEpoch },
						deposit: depositAbsent,
						redeem: {
							kind: "value",
							value: { shares: 30_0000000n, claimed: false },
						},
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [
				{
					epochId: 2n,
					side: "redeem",
					epochStatus: pendingEpoch.status,
					sharePrice: pendingEpoch.share_price as Price,
					amount: 30_0000000n as Amount,
					claimed: false,
					priceableAt: pendingEpoch.priceable_at,
				},
			],
			archived: [],
			unreadable: [],
		})
	})

	it("an archived epoch leaves no trace in any bucket", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 1n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "archived" },
						deposit: depositAbsent,
						redeem: redeemAbsent,
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [],
			archived: [],
			unreadable: [],
		})
	})

	it("a single unreadable request never blanks a request readable elsewhere in the same epoch", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 1n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "value", value: openEpoch },
						deposit: depositUnreadable,
						redeem: {
							kind: "value",
							value: { shares: 10_0000000n, claimed: false },
						},
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [
				{
					epochId: 1n,
					side: "redeem",
					epochStatus: openEpoch.status,
					sharePrice: openEpoch.share_price as Price,
					amount: 10_0000000n as Amount,
					claimed: false,
					priceableAt: openEpoch.priceable_at,
				},
			],
			archived: [],
			unreadable: [{ epochId: 1n, side: "deposit" }],
		})
	})

	it("reports unreadable rather than an empty list when the epoch count itself fails", async () => {
		vaultMock.current_epoch.mockRejectedValue(new Error("network down"))

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({ status: "unreadable" })
		expect(readEpochRequestsMock).not.toHaveBeenCalled()
	})

	it("renders a request from an epoch where the reader decodes the other side's absence as null", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 2n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "value", value: pendingEpoch },
						deposit: depositAbsent,
						redeem: redeemAbsent,
					},
				],
				[
					2n,
					{
						epoch: { kind: "value", value: pendingEpoch },
						deposit: depositAbsent,
						redeem: {
							kind: "value",
							value: { shares: 10_0000000n, claimed: false },
						},
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [
				{
					epochId: 2n,
					side: "redeem",
					epochStatus: pendingEpoch.status,
					sharePrice: pendingEpoch.share_price as Price,
					amount: 10_0000000n as Amount,
					claimed: false,
					priceableAt: pendingEpoch.priceable_at,
				},
			],
			archived: [],
			unreadable: [],
		})
	})

	it("marks both sides unreadable on a genuine None epoch, without losing a readable epoch elsewhere", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 2n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "value", value: null },
						deposit: depositAbsent,
						redeem: redeemAbsent,
					},
				],
				[
					2n,
					{
						epoch: { kind: "value", value: openEpoch },
						deposit: {
							kind: "value",
							value: { amount: 10_0000000n, claimed: false },
						},
						redeem: redeemAbsent,
					},
				],
			]),
		)

		const result = await fetchInvestorRequests(controller)

		expect(result).toEqual({
			status: "loaded",
			requests: [
				{
					epochId: 2n,
					side: "deposit",
					epochStatus: openEpoch.status,
					sharePrice: openEpoch.share_price as Price,
					amount: 10_0000000n as Amount,
					claimed: false,
					priceableAt: openEpoch.priceable_at,
				},
			],
			archived: [],
			unreadable: [
				{ epochId: 1n, side: "deposit" },
				{ epochId: 1n, side: "redeem" },
			],
		})
	})

	it("delegates the whole range to the reader in one call past the 66-epoch chunk size", async () => {
		const currentEpoch = 67n
		const expectedEpochIds: bigint[] = []
		const fixture = new Map<bigint, EpochRequestsRead>()
		for (let epochId = 1n; epochId <= currentEpoch; epochId++) {
			expectedEpochIds.push(epochId)
			fixture.set(epochId, {
				epoch: { kind: "value", value: openEpoch },
				deposit:
					epochId === currentEpoch
						? { kind: "value", value: { amount: 10_0000000n, claimed: false } }
						: depositAbsent,
				redeem: redeemAbsent,
			})
		}
		vaultMock.current_epoch.mockResolvedValue({ result: currentEpoch })
		readEpochRequestsMock.mockResolvedValue(fixture)

		const result = await fetchInvestorRequests(controller)

		expect(readEpochRequestsMock).toHaveBeenCalledTimes(1)
		expect(readEpochRequestsMock).toHaveBeenCalledWith(
			addresses.async_vault,
			controller,
			expectedEpochIds,
		)
		expect(result).toEqual({
			status: "loaded",
			requests: [
				{
					epochId: currentEpoch,
					side: "deposit",
					epochStatus: openEpoch.status,
					sharePrice: openEpoch.share_price as Price,
					amount: 10_0000000n as Amount,
					claimed: false,
					priceableAt: openEpoch.priceable_at,
				},
			],
			archived: [],
			unreadable: [],
		})
	})
})

describe("useInvestorRequests", () => {
	const investorAddress = "GINVESTORADDRESS1234567890"

	const wallet: WalletContextType = {
		address: investorAddress,
		networkPassphrase,
		balances: {},
		isPending: false,
		updateBalances: async () => {},
		signTransaction: vi.fn() as WalletContextType["signTransaction"],
	}

	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultMock.mockResolvedValue(vaultMock)
	})

	const renderInvestorRequests = () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(WalletContext, { value: wallet }, children),
			)
		return {
			...renderHook(() => useInvestorRequests(), { wrapper }),
			queryClient,
		}
	}

	it("surfaces unreadable, not an endless checking state, when the vault client fails to connect", async () => {
		asyncVaultMock.mockRejectedValueOnce(new Error("could not connect"))

		const { result } = renderInvestorRequests()

		await waitFor(() => {
			expect(result.current.requests).toEqual({ status: "unreadable" })
		})
	})

	it("keeps a loaded list on screen when a later background refetch fails", async () => {
		asyncVaultMock.mockResolvedValue(vaultMock)
		vaultMock.current_epoch.mockResolvedValue({ result: 1n })
		readEpochRequestsMock.mockResolvedValue(
			new Map<bigint, EpochRequestsRead>([
				[
					1n,
					{
						epoch: { kind: "value", value: openEpoch },
						deposit: depositAbsent,
						redeem: redeemAbsent,
					},
				],
			]),
		)

		const { result, queryClient } = renderInvestorRequests()

		await waitFor(() => {
			expect(result.current.requests).toEqual({
				status: "loaded",
				requests: [],
				archived: [],
				unreadable: [],
			})
		})

		asyncVaultMock.mockRejectedValueOnce(new Error("could not connect"))
		await act(() =>
			queryClient.refetchQueries({
				queryKey: ["investor", "requests", investorAddress],
			}),
		)

		await waitFor(() => {
			expect(
				queryClient.getQueryState(["investor", "requests", investorAddress])
					?.status,
			).toBe("error")
		})
		expect(result.current.requests).toEqual({
			status: "loaded",
			requests: [],
			archived: [],
			unreadable: [],
		})
	})
})

describe("investorRequestsKey", () => {
	it("matches the key useInvestorRequests queries under", () => {
		expect(investorRequestsKey("GINVESTORADDRESS1234567890")).toEqual([
			"investor",
			"requests",
			"GINVESTORADDRESS1234567890",
		])
	})
})

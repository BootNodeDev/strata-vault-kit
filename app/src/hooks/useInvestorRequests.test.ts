import {
	type Amount,
	type ContractRead,
	type DepositRequest,
	type EpochInfo,
	type Option,
	type Price,
	type RedeemRequest,
	networkPassphrase,
} from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
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

const { vaultMock, asyncVaultMock } = vi.hoisted(() => ({
	vaultMock: {
		current_epoch: vi.fn(),
		get_epoch: vi.fn(),
		get_deposit_request: vi.fn(),
		get_redeem_request: vi.fn(),
	},
	asyncVaultMock: vi.fn(),
}))
asyncVaultMock.mockResolvedValue(vaultMock)

vi.mock("../config/clients", () => ({
	asyncVault: asyncVaultMock,
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

const depositPresent: ContractRead<Option<DepositRequest>> = {
	kind: "value",
	value: { amount: 100_0000000n, claimed: false },
}
const depositClaimed: ContractRead<Option<DepositRequest>> = {
	kind: "value",
	value: { amount: 100_0000000n, claimed: true },
}
const depositAbsent: ContractRead<Option<DepositRequest>> = {
	kind: "value",
	value: null,
}
const depositUnreadable: ContractRead<Option<DepositRequest>> = {
	kind: "unreadable",
}
const depositArchived: ContractRead<Option<DepositRequest>> = {
	kind: "archived",
}

const redeemPresent: ContractRead<Option<RedeemRequest>> = {
	kind: "value",
	value: { shares: 20_0000000n, claimed: false },
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
	it("walks every epoch, skipping a gap without stopping", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 3n })
		vaultMock.get_epoch.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result: [undefined, openEpoch, pendingEpoch, fulfilledEpoch][
					Number(epoch_id)
				],
			}),
		)
		vaultMock.get_deposit_request.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result:
					epoch_id === 1n
						? { amount: 100_0000000n, claimed: false }
						: epoch_id === 3n
							? { amount: 50_0000000n, claimed: true }
							: undefined,
			}),
		)
		vaultMock.get_redeem_request.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result:
					epoch_id === 3n ? { shares: 20_0000000n, claimed: false } : undefined,
			}),
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
				},
				{
					epochId: 3n,
					side: "deposit",
					epochStatus: fulfilledEpoch.status,
					sharePrice: fulfilledEpoch.share_price as Price,
					amount: 50_0000000n as Amount,
					claimed: true,
				},
				{
					epochId: 3n,
					side: "redeem",
					epochStatus: fulfilledEpoch.status,
					sharePrice: fulfilledEpoch.share_price as Price,
					amount: 20_0000000n as Amount,
					claimed: false,
				},
			],
			archived: [],
			unreadable: [],
		})
	})

	it("collects an archived entry separately, never as absent or merged into requests", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 1n })
		vaultMock.get_epoch.mockResolvedValue({ result: openEpoch })
		vaultMock.get_deposit_request.mockImplementation(async () => ({
			simulation: {
				transactionData: {},
				restorePreamble: { minResourceFee: "100", transactionData: {} },
			},
			get result(): DepositRequest {
				throw new Error("You need to restore some contract state first")
			},
		}))
		vaultMock.get_redeem_request.mockResolvedValue({ result: undefined })

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
		vaultMock.get_epoch.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) =>
				epoch_id === 1n
					? Promise.reject(new Error("network down"))
					: { result: pendingEpoch },
		)
		vaultMock.get_deposit_request.mockResolvedValue({ result: undefined })
		vaultMock.get_redeem_request.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result:
					epoch_id === 2n ? { shares: 30_0000000n, claimed: false } : undefined,
			}),
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
				},
			],
			archived: [],
			unreadable: [
				{ epochId: 1n, side: "deposit" },
				{ epochId: 1n, side: "redeem" },
			],
		})
	})

	it("renders a live current-epoch request while an older epoch's get_epoch is archived", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 2n })
		vaultMock.get_epoch.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) =>
				epoch_id === 1n
					? {
							simulation: {
								transactionData: {},
								restorePreamble: {
									minResourceFee: "100",
									transactionData: {},
								},
							},
							get result(): EpochInfo {
								throw new Error("You need to restore some contract state first")
							},
						}
					: { result: pendingEpoch },
		)
		vaultMock.get_deposit_request.mockResolvedValue({ result: undefined })
		vaultMock.get_redeem_request.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result:
					epoch_id === 2n ? { shares: 30_0000000n, claimed: false } : undefined,
			}),
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
				},
			],
			archived: [],
			unreadable: [
				{ epochId: 1n, side: "deposit" },
				{ epochId: 1n, side: "redeem" },
			],
		})
	})

	it("a single unreadable request never blanks a request readable elsewhere in the same epoch", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 1n })
		vaultMock.get_epoch.mockResolvedValue({ result: openEpoch })
		vaultMock.get_deposit_request.mockRejectedValue(new Error("network down"))
		vaultMock.get_redeem_request.mockResolvedValue({
			result: { shares: 10_0000000n, claimed: false },
		})

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
	})

	it("renders a request from an epoch where the SDK decodes the other side's absence as null", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 2n })
		vaultMock.get_epoch.mockResolvedValue({ result: pendingEpoch })
		vaultMock.get_deposit_request.mockResolvedValue({ result: null })
		vaultMock.get_redeem_request.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result:
					epoch_id === 2n ? { shares: 10_0000000n, claimed: false } : null,
			}),
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
				},
			],
			archived: [],
			unreadable: [],
		})
	})

	it("marks both sides unreadable on a genuine None epoch, without losing a readable epoch elsewhere", async () => {
		vaultMock.current_epoch.mockResolvedValue({ result: 2n })
		vaultMock.get_epoch.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result: epoch_id === 1n ? undefined : openEpoch,
			}),
		)
		vaultMock.get_deposit_request.mockImplementation(
			async ({ epoch_id }: { epoch_id: bigint }) => ({
				result:
					epoch_id === 2n ? { amount: 10_0000000n, claimed: false } : undefined,
			}),
		)
		vaultMock.get_redeem_request.mockResolvedValue({ result: undefined })

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
				},
			],
			archived: [],
			unreadable: [
				{ epochId: 1n, side: "deposit" },
				{ epochId: 1n, side: "redeem" },
			],
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
		vaultMock.get_epoch.mockResolvedValue({ result: openEpoch })
		vaultMock.get_deposit_request.mockResolvedValue({ result: undefined })
		vaultMock.get_redeem_request.mockResolvedValue({ result: undefined })

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

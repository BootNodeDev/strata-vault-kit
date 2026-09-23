import {
	type Amount,
	type ContractRead,
	type DepositRequest,
	type EpochInfo,
	type Price,
	type RedeemRequest,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { classifyRequest, fetchInvestorRequests } from "./useInvestorRequests"

const { vaultMock } = vi.hoisted(() => ({
	vaultMock: {
		current_epoch: vi.fn(),
		get_epoch: vi.fn(),
		get_deposit_request: vi.fn(),
		get_redeem_request: vi.fn(),
	},
}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => vaultMock,
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

const depositPresent: ContractRead<DepositRequest | undefined> = {
	kind: "value",
	value: { amount: 100_0000000n, claimed: false },
}
const depositClaimed: ContractRead<DepositRequest | undefined> = {
	kind: "value",
	value: { amount: 100_0000000n, claimed: true },
}
const depositAbsent: ContractRead<DepositRequest | undefined> = {
	kind: "value",
	value: undefined,
}
const depositUnreadable: ContractRead<DepositRequest | undefined> = {
	kind: "unreadable",
}
const depositArchived: ContractRead<DepositRequest | undefined> = {
	kind: "archived",
}

const redeemPresent: ContractRead<RedeemRequest | undefined> = {
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
})

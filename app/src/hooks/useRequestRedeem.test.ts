import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import {
	AMOUNT_DECIMALS,
	type Amount,
	networkPassphrase,
} from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
import { investorRequestsKey } from "./useInvestorRequests"
import { useRequestRedeem } from "./useRequestRedeem"
import { sharePositionKey } from "./useSharePosition"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { request_redeem: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))
asyncVaultWriterMock.mockResolvedValue(vaultMock)

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const investorAddress = "GINVESTORADDRESS1234567890"
const shares = (100n * 10n ** BigInt(AMOUNT_DECIMALS)) as Amount

const wallet: WalletContextType = {
	address: investorAddress,
	networkPassphrase,
	balances: {},
	isPending: false,
	updateBalances: async () => {},
	signTransaction: vi.fn() as WalletContextType["signTransaction"],
}

const renderRequestRedeem = () => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(WalletContext, { value: wallet }, children),
		)
	return { ...renderHook(() => useRequestRedeem(), { wrapper }), queryClient }
}

const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("useRequestRedeem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("calls request_redeem with the shares to escrow", async () => {
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 7n,
			}),
		})
		const { result } = renderRequestRedeem()

		await act(() => result.current.submit(shares))

		expect(vaultMock.request_redeem).toHaveBeenCalledWith({
			from: investorAddress,
			shares,
		})
	})

	it("moves through awaiting signature, submitted, then confirmed, in order", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return { getTransactionResponse: { status: "SUCCESS" }, result: 7n }
			},
		)
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestRedeem()

		void result.current.submit(shares)

		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		signingGate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)

		confirmGate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "confirmed",
				epochId: 7n,
			}),
		)

		expect(signAndSend).toHaveBeenCalledTimes(1)
	})

	it("invalidates the investor's cached requests once the redemption request confirms", async () => {
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 7n,
			}),
		})
		const { result, queryClient } = renderRequestRedeem()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(shares))

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
	})

	it("invalidates the investor's cached share position once the redemption request confirms", async () => {
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 7n,
			}),
		})
		const { result, queryClient } = renderRequestRedeem()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(shares))

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: sharePositionKey(investorAddress),
		})
	})

	it("does not touch the investor's cached requests on a failed redemption request", async () => {
		vaultMock.request_redeem.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6009)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderRequestRedeem()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(shares))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.request_redeem.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6009)" },
			signAndSend,
		})
		const { result } = renderRequestRedeem()

		await act(() => result.current.submit(shares))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6009 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderRequestRedeem()

		await act(() => result.current.submit(shares))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("fails plainly when the network drops after the transaction was submitted", async () => {
		const dropGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				watcher.onSubmitted()
				await dropGate.promise
				throw new Error("network error")
			},
		)
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestRedeem()

		void result.current.submit(shares)

		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)
		dropGate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "unknown" },
			}),
		)
	})

	it("carries the transaction hash from submission through to confirmation", async () => {
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({
				watcher,
			}: {
				watcher: { onSubmitted: (response: { hash: string }) => void }
			}) => {
				watcher.onSubmitted({ hash: "a".repeat(64) })
				await confirmGate.promise
				return { getTransactionResponse: { status: "SUCCESS" }, result: 7n }
			},
		)
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestRedeem()

		void result.current.submit(shares)

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "submitted",
				hash: "a".repeat(64),
			}),
		)

		confirmGate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "confirmed",
				epochId: 7n,
				hash: "a".repeat(64),
			}),
		)
	})

	it("ignores a second submission while one is already in flight", async () => {
		const gate = deferred<void>()
		const signAndSend = vi.fn(async () => {
			await gate.promise
			return { getTransactionResponse: { status: "SUCCESS" }, result: 7n }
		})
		vaultMock.request_redeem.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestRedeem()

		void result.current.submit(shares)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(shares)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.request_redeem).toHaveBeenCalledTimes(1)
	})

	it("marks a wallet connection failure that happens before any signature is requested as interrupted, not unknown", async () => {
		asyncVaultWriterMock.mockRejectedValueOnce(new Error("could not connect"))
		const { result } = renderRequestRedeem()

		await act(() => result.current.submit(shares))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "interrupted" },
		})
	})
})

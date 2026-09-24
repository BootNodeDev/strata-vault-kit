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
import { depositBalanceKey } from "./useDepositBalance"
import { investorRequestsKey } from "./useInvestorRequests"
import { useRequestDeposit } from "./useRequestDeposit"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { request_deposit: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))
asyncVaultWriterMock.mockResolvedValue(vaultMock)

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const investorAddress = "GINVESTORADDRESS1234567890"
const amount = (100n * 10n ** BigInt(AMOUNT_DECIMALS)) as Amount

const wallet: WalletContextType = {
	address: investorAddress,
	networkPassphrase,
	balances: {},
	isPending: false,
	updateBalances: async () => {},
	signTransaction: vi.fn() as WalletContextType["signTransaction"],
}

const renderRequestDeposit = () => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(WalletContext, { value: wallet }, children),
		)
	return { ...renderHook(() => useRequestDeposit(), { wrapper }), queryClient }
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

describe("useRequestDeposit", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
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
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestDeposit()

		void result.current.submit(amount)

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

	it("invalidates the investor's cached requests once the deposit confirms", async () => {
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 7n,
			}),
		})
		const { result, queryClient } = renderRequestDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(amount))

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
	})

	it("invalidates the investor's cached deposit balance once the deposit confirms", async () => {
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 7n,
			}),
		})
		const { result, queryClient } = renderRequestDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(amount))

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: depositBalanceKey(investorAddress),
		})
	})

	it("does not touch the investor's cached requests or balance on a failed deposit", async () => {
		vaultMock.request_deposit.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6009)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderRequestDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(amount))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.request_deposit.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6009)" },
			signAndSend,
		})
		const { result } = renderRequestDeposit()

		await act(() => result.current.submit(amount))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6009 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderRequestDeposit()

		await act(() => result.current.submit(amount))

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
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestDeposit()

		void result.current.submit(amount)

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
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestDeposit()

		void result.current.submit(amount)

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

	it("carries the transaction hash on a failure discovered after submission", async () => {
		const signAndSend = vi.fn(
			async ({
				watcher,
			}: {
				watcher: { onSubmitted: (response: { hash: string }) => void }
			}) => {
				watcher.onSubmitted({ hash: "b".repeat(64) })
				return { getTransactionResponse: { status: "FAILED" }, result: 7n }
			},
		)
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestDeposit()

		await act(() => result.current.submit(amount))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "unknown" },
			hash: "b".repeat(64),
		})
	})

	it("carries no transaction hash on a failure that never reached the network", async () => {
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderRequestDeposit()

		await act(() => result.current.submit(amount))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
		expect(
			result.current.status.status === "failed"
				? result.current.status.hash
				: "not a failure",
		).toBeUndefined()
	})

	it("ignores a second submission while one is already in flight", async () => {
		const gate = deferred<void>()
		const signAndSend = vi.fn(async () => {
			await gate.promise
			return { getTransactionResponse: { status: "SUCCESS" }, result: 7n }
		})
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestDeposit()

		void result.current.submit(amount)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(amount)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.request_deposit).toHaveBeenCalledTimes(1)
	})

	it("reconnects a dismissed caller to a still-settling submission instead of ignoring it", async () => {
		const gate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				watcher.onSubmitted()
				await gate.promise
				return { getTransactionResponse: { status: "SUCCESS" }, result: 7n }
			},
		)
		vaultMock.request_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderRequestDeposit()

		void result.current.submit(amount)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)

		act(() => result.current.reset())
		expect(result.current.status).toEqual({ status: "idle" })

		void result.current.submit(amount)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)
		expect(vaultMock.request_deposit).toHaveBeenCalledTimes(1)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))
	})
})

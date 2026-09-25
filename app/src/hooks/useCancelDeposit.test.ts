import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { networkPassphrase } from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
import { useCancelDeposit } from "./useCancelDeposit"
import { depositBalanceKey } from "./useDepositBalance"
import { investorRequestsKey } from "./useInvestorRequests"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { cancel_deposit: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))
asyncVaultWriterMock.mockResolvedValue(vaultMock)

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const investorAddress = "GINVESTORADDRESS1234567890"
const epochId = 3n
const otherEpochId = 4n

const wallet: WalletContextType = {
	address: investorAddress,
	networkPassphrase,
	balances: {},
	isPending: false,
	updateBalances: async () => {},
	signTransaction: vi.fn() as WalletContextType["signTransaction"],
}

const renderCancelDeposit = () => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(WalletContext, { value: wallet }, children),
		)
	return { ...renderHook(() => useCancelDeposit(), { wrapper }), queryClient }
}

const deferred = <T>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

describe("useCancelDeposit", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("moves through awaiting signature, submitted, then confirmed with the refunded amount, in order", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: 100_0000000n,
				}
			},
		)
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderCancelDeposit()

		void result.current.submit(epochId)

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
				refundedAmount: 100_0000000n,
			}),
		)

		expect(vaultMock.cancel_deposit).toHaveBeenCalledWith({
			from: investorAddress,
			epoch_id: epochId,
		})
	})

	it("shows preparing the instant the first press happens, before any network call resolves", async () => {
		const clientGate = deferred<typeof vaultMock>()
		asyncVaultWriterMock.mockReturnValueOnce(clientGate.promise)
		const { result } = renderCancelDeposit()

		void result.current.submit(epochId)

		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "preparing" }),
		)
		expect(vaultMock.cancel_deposit).not.toHaveBeenCalled()
	})

	it("invalidates the investor's cached requests and deposit balance once the cancellation confirms", async () => {
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 100_0000000n,
			}),
		})
		const { result, queryClient } = renderCancelDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: depositBalanceKey(investorAddress),
		})
	})

	it("does not touch cached requests or balance when the vault refuses at simulation", async () => {
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6039)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderCancelDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6039)" },
			signAndSend,
		})
		const { result } = renderCancelDeposit()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6039 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderCancelDeposit()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("invalidates cached requests and balance for an unknown outcome that reached the network but never confirmed", async () => {
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "FAILED" },
				result: 100_0000000n,
			}),
		})
		const { result, queryClient } = renderCancelDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "unknown" },
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: depositBalanceKey(investorAddress),
		})
	})

	it("does not invalidate anything when the failure happened before the transaction ever reached the network", async () => {
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockRejectedValue(new Error("could not broadcast")),
		})
		const { result, queryClient } = renderCancelDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "unknown" },
		})
		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("marks a wallet connection failure that happens before any signature is requested as interrupted, not unknown", async () => {
		asyncVaultWriterMock.mockRejectedValueOnce(new Error("could not connect"))
		const { result } = renderCancelDeposit()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "interrupted" },
		})
	})

	it("ignores a second submission while one is already in flight", async () => {
		const gate = deferred<void>()
		const signAndSend = vi.fn(async () => {
			await gate.promise
			return {
				getTransactionResponse: { status: "SUCCESS" },
				result: 100_0000000n,
			}
		})
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderCancelDeposit()

		void result.current.submit(epochId)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(epochId)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.cancel_deposit).toHaveBeenCalledTimes(1)
	})

	it("reconnects a dismissed caller to a still-settling submission instead of ignoring it", async () => {
		const gate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				watcher.onSubmitted()
				await gate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: 100_0000000n,
				}
			},
		)
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderCancelDeposit()

		void result.current.submit(epochId)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)

		act(() => result.current.reset())
		expect(result.current.status).toEqual({ status: "idle" })

		void result.current.submit(epochId)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)
		expect(vaultMock.cancel_deposit).toHaveBeenCalledTimes(1)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))
	})

	it("submits a different request instead of replaying the one already in flight", async () => {
		const gate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				watcher.onSubmitted()
				await gate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: 100_0000000n,
				}
			},
		)
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderCancelDeposit()

		void result.current.submit(epochId)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)

		act(() => result.current.reset())
		void result.current.submit(otherEpochId)

		await waitFor(() =>
			expect(vaultMock.cancel_deposit).toHaveBeenCalledWith({
				from: investorAddress,
				epoch_id: otherEpochId,
			}),
		)

		gate.resolve()
	})

	it("keeps a superseded submission from narrating over the request pressed after it", async () => {
		const gates = new Map<bigint, ReturnType<typeof deferred<void>>>()
		vaultMock.cancel_deposit.mockImplementation(
			({ epoch_id }: { epoch_id: bigint }) => {
				const gate = deferred<void>()
				gates.set(epoch_id, gate)
				return Promise.resolve({
					simulation: undefined,
					signAndSend: async ({
						watcher,
					}: {
						watcher: { onSubmitted: () => void }
					}) => {
						watcher.onSubmitted()
						await gate.promise
						return {
							getTransactionResponse: { status: "SUCCESS" },
							result: 100_0000000n,
						}
					},
				})
			},
		)
		const { result } = renderCancelDeposit()

		const first = result.current.submit(epochId)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)

		act(() => result.current.reset())
		void result.current.submit(otherEpochId)
		await waitFor(() => expect(gates.has(otherEpochId)).toBe(true))

		gates.get(epochId)?.resolve()
		await act(() => first)

		expect(result.current.status).toEqual({ status: "submitted" })

		gates.get(otherEpochId)?.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))
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
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: 100_0000000n,
				}
			},
		)
		vaultMock.cancel_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderCancelDeposit()

		void result.current.submit(epochId)

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
				refundedAmount: 100_0000000n,
				hash: "a".repeat(64),
			}),
		)
	})
})

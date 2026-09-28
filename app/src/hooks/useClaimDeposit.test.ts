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
import { useClaimDeposit } from "./useClaimDeposit"
import { depositBalanceKey } from "./useDepositBalance"
import { investorRequestsKey } from "./useInvestorRequests"
import { sharePositionKey } from "./useSharePosition"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { claim_deposit: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))
asyncVaultWriterMock.mockResolvedValue(vaultMock)

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const investorAddress = "GINVESTORADDRESS1234567890"
const epochId = 3n

const wallet: WalletContextType = {
	address: investorAddress,
	networkPassphrase,
	balances: {},
	isPending: false,
	updateBalances: async () => {},
	signTransaction: vi.fn() as WalletContextType["signTransaction"],
}

const deferred = <T>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

const renderClaimDeposit = () => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(WalletContext, { value: wallet }, children),
		)
	return { ...renderHook(() => useClaimDeposit(), { wrapper }), queryClient }
}

describe("useClaimDeposit", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("reports whether the submission was accepted synchronously, not through a promise", () => {
		const { result } = renderClaimDeposit()

		const accepted = result.current.submit(epochId)

		expect(accepted).toBe(true)
	})

	it("moves through awaiting signature, submitted, then confirmed with the shares minted, in order", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: 50_0000000n,
				}
			},
		)
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderClaimDeposit()

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
				sharesMinted: 50_0000000n,
			}),
		)

		expect(vaultMock.claim_deposit).toHaveBeenCalledWith({
			caller: investorAddress,
			epoch_id: epochId,
		})
	})

	it("carries a zero result through as confirmed, not as a failure", async () => {
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 0n,
			}),
		})
		const { result } = renderClaimDeposit()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "confirmed",
			sharesMinted: 0n,
		})
	})

	it("invalidates the investor's cached requests, deposit balance and share position once the claim confirms", async () => {
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: 50_0000000n,
			}),
		})
		const { result, queryClient } = renderClaimDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: depositBalanceKey(investorAddress),
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: sharePositionKey(investorAddress),
		})
	})

	it("does not touch cached requests, balance or share position when the vault refuses at simulation", async () => {
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6035)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderClaimDeposit()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6035)" },
			signAndSend,
		})
		const { result } = renderClaimDeposit()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6035 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("refuses at simulation with the identity verifier's cross-contract code", async () => {
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #304)" },
			signAndSend: vi.fn(),
		})
		const { result } = renderClaimDeposit()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderClaimDeposit()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("ignores a second submission while one is already in flight", async () => {
		const gate = (() => {
			let resolve!: () => void
			const promise = new Promise<void>((res) => {
				resolve = res
			})
			return { promise, resolve }
		})()
		const signAndSend = vi.fn(async () => {
			await gate.promise
			return {
				getTransactionResponse: { status: "SUCCESS" },
				result: 50_0000000n,
			}
		})
		vaultMock.claim_deposit.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderClaimDeposit()

		void result.current.submit(epochId)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(epochId)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.claim_deposit).toHaveBeenCalledTimes(1)
	})
})

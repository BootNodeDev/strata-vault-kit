import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import {
	AMOUNT_DECIMALS,
	type Amount,
	networkPassphrase,
} from "@stellar-scaffold/app-lib"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
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
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(WalletContext, { value: wallet }, children)
	return renderHook(() => useRequestDeposit(), { wrapper })
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
})

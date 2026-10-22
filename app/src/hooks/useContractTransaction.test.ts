import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { act, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { investorAddress, renderWithWallet } from "./testSupport"
import { useContractTransaction } from "./useContractTransaction"
import { investorRequestsKey } from "./useInvestorRequests"

const { submitSignedMock } = vi.hoisted(() => ({ submitSignedMock: vi.fn() }))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	submitSigned: submitSignedMock,
}))

const extraKeys = [
	["cycle", "history"],
	["vault", "figures"],
] as const

const transaction = (simulationError?: string) =>
	({
		simulation:
			simulationError === undefined ? undefined : { error: simulationError },
		signAndSend: vi.fn().mockResolvedValue({
			getTransactionResponse: { status: "SUCCESS" },
			result: 1n,
		}),
		sign: vi.fn().mockResolvedValue(undefined),
		signed: { signedBy: "wallet" },
		result: 1n,
	}) as unknown as AssembledTransaction<bigint>

const renderTransaction = (simulationError?: string) =>
	renderWithWallet(() =>
		useContractTransaction(
			async () => transaction(simulationError),
			(result: bigint) => ({ result }),
			extraKeys,
		),
	)

describe("useContractTransaction", () => {
	it("refreshes the extra query keys alongside the investor's once the transaction confirms", async () => {
		const { result, queryClient } = renderTransaction()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(result.current.status).toEqual({ status: "confirmed", result: 1n })
		for (const queryKey of extraKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
	})

	it("refreshes only the extra query keys when the contract refuses at simulation", async () => {
		const { result, queryClient } = renderTransaction(
			"HostError: Error(Contract, #6046)",
		)
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(invalidateQueries).toHaveBeenCalledTimes(extraKeys.length)
		for (const queryKey of extraKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
	})

	it("keeps the same submit across rerenders when no extra keys are given", () => {
		const call = async () => transaction()
		const toConfirmed = (result: bigint) => ({ result })
		const { result, rerender } = renderWithWallet(() =>
			useContractTransaction(call, toConfirmed),
		)
		const { submit } = result.current

		rerender()

		expect(result.current.submit).toBe(submit)
	})

	it("refreshes only the investor's caches when no extra keys are given", async () => {
		const { result, queryClient } = renderWithWallet(() =>
			useContractTransaction(
				async () => transaction(),
				(result: bigint) => ({ result }),
			),
		)
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(invalidateQueries).toHaveBeenCalledTimes(3)
	})
})

const flush = () =>
	waitFor(() => new Promise((resolve) => setTimeout(resolve, 0)))

const renderPrepared = (
	call: (signer: unknown, arg: bigint) => Promise<AssembledTransaction<bigint>>,
) =>
	renderWithWallet(() =>
		useContractTransaction(call, (result: bigint) => ({ result }), extraKeys),
	)

describe("useContractTransaction, prepared simulations", () => {
	beforeEach(() => {
		submitSignedMock.mockReset()
		submitSignedMock.mockResolvedValue({
			status: "success",
			hash: "h",
			result: 1n,
		})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("signs the prepared transaction without simulating again", async () => {
		const prepared = transaction()
		const call = vi.fn().mockResolvedValue(prepared)
		const { result } = renderPrepared(call)

		act(() => {
			result.current.prepare(5n)
		})
		await flush()
		await act(() => result.current.submit(5n))
		await flush()

		expect(call).toHaveBeenCalledTimes(1)
		expect(prepared.sign).toHaveBeenCalledTimes(1)
		expect(submitSignedMock).toHaveBeenCalledWith(prepared.signed)
		expect(result.current.status).toEqual({
			status: "confirmed",
			result: 1n,
			hash: "h",
		})
	})

	it("simulates again when the prepared transaction is 30 seconds old", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
		const call = vi.fn(async () => transaction())
		const { result } = renderPrepared(call)

		act(() => {
			result.current.prepare(5n)
		})
		await flush()
		now.mockReturnValue(1_030_000)
		await act(() => result.current.submit(5n))
		await flush()

		expect(call).toHaveBeenCalledTimes(2)
	})

	it("simulates again when the argument differs from the prepared one", async () => {
		const call = vi.fn(async () => transaction())
		const { result } = renderPrepared(call)

		act(() => {
			result.current.prepare(5n)
		})
		await flush()
		await act(() => result.current.submit(6n))
		await flush()

		expect(call).toHaveBeenCalledTimes(2)
		expect(call).toHaveBeenLastCalledWith(expect.anything(), 6n)
	})

	it("keeps the prepared transaction when a refetch returns the same reads", async () => {
		const call = vi.fn(async () => transaction())
		const { result, queryClient } = renderPrepared(call)
		const read = () =>
			queryClient.fetchQuery({
				queryKey: [...extraKeys[0], "epoch"],
				queryFn: () => ({ epoch: 4 }),
			})
		await act(read)

		act(() => {
			result.current.prepare(5n)
		})
		await flush()
		await act(() => queryClient.refetchQueries({ queryKey: extraKeys[0] }))
		await flush()
		await act(() => result.current.submit(5n))
		await flush()

		expect(call).toHaveBeenCalledTimes(1)
	})

	it("simulates again in the background when a refetch changes the reads", async () => {
		const first = transaction()
		const second = transaction()
		const call = vi
			.fn()
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second)
		const { result, queryClient } = renderPrepared(call)
		let epoch = 4
		const queryKey = [...extraKeys[0], "epoch"]
		await act(() =>
			queryClient.fetchQuery({ queryKey, queryFn: () => ({ epoch }) }),
		)

		act(() => {
			result.current.prepare(5n)
		})
		await flush()
		epoch = 5
		await act(() => queryClient.refetchQueries({ queryKey }))
		await flush()

		expect(call).toHaveBeenCalledTimes(2)

		await act(() => result.current.submit(5n))
		await flush()

		expect(call).toHaveBeenCalledTimes(2)
		expect(first.sign).not.toHaveBeenCalled()
		expect(second.sign).toHaveBeenCalledTimes(1)
	})

	it("simulates again in the background once the prepared transaction expires", async () => {
		vi.useFakeTimers()
		const call = vi.fn(async () => transaction())
		const { result } = renderPrepared(call)

		act(() => {
			result.current.prepare(5n)
		})
		await act(() => vi.advanceTimersByTimeAsync(0))
		await act(() => vi.advanceTimersByTimeAsync(29_999))

		expect(call).toHaveBeenCalledTimes(1)

		await act(() => vi.advanceTimersByTimeAsync(1))

		expect(call).toHaveBeenCalledTimes(2)
	})

	it("shows nothing when the background simulation fails", async () => {
		const call = vi.fn().mockRejectedValue(new Error("rpc down"))
		const { result } = renderPrepared(call)

		act(() => {
			result.current.prepare(5n)
		})
		await flush()

		expect(result.current.status).toEqual({ status: "idle" })

		await act(() => result.current.submit(5n))
		await flush()

		expect(call).toHaveBeenCalledTimes(2)
		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "interrupted" },
		})
	})

	it("asks to try again when the prepared transaction's sequence was consumed", async () => {
		submitSignedMock.mockResolvedValueOnce({
			status: "failed",
			reason: "sequence-consumed",
			hash: "h",
		})
		const call = vi
			.fn()
			.mockResolvedValueOnce(transaction())
			.mockResolvedValueOnce(transaction())
		const { result } = renderPrepared(call)

		act(() => {
			result.current.prepare(5n)
		})
		await flush()
		await act(() => result.current.submit(5n))
		await flush()

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "stale" },
			hash: "h",
		})

		await act(() => result.current.submit(5n))
		await flush()

		expect(call).toHaveBeenCalledTimes(2)
		expect(result.current.status).toEqual({ status: "confirmed", result: 1n })
	})

	it("keeps a released transaction reusable within 30 seconds", async () => {
		vi.useFakeTimers()
		const prepared = transaction()
		const call = vi.fn().mockResolvedValue(prepared)
		const { result } = renderPrepared(call)

		let release = () => {}
		act(() => {
			release = result.current.prepare(5n)
		})
		await act(() => vi.advanceTimersByTimeAsync(0))
		release()
		await act(() => vi.advanceTimersByTimeAsync(20_000))
		await act(() => result.current.submit(5n))
		await act(() => vi.advanceTimersByTimeAsync(0))

		expect(call).toHaveBeenCalledTimes(1)
		expect(prepared.sign).toHaveBeenCalledTimes(1)
	})

	it("does not refresh a released transaction once it expires", async () => {
		vi.useFakeTimers()
		const call = vi.fn(async () => transaction())
		const { result } = renderPrepared(call)

		let release = () => {}
		act(() => {
			release = result.current.prepare(5n)
		})
		await act(() => vi.advanceTimersByTimeAsync(0))
		release()
		await act(() => vi.advanceTimersByTimeAsync(30_000))

		expect(call).toHaveBeenCalledTimes(1)
	})

	it("does not refresh a released transaction when the reads change", async () => {
		const call = vi.fn(async () => transaction())
		const { result, queryClient } = renderPrepared(call)
		let epoch = 4
		const queryKey = [...extraKeys[0], "epoch"]
		await act(() =>
			queryClient.fetchQuery({ queryKey, queryFn: () => ({ epoch }) }),
		)

		let release = () => {}
		act(() => {
			release = result.current.prepare(5n)
		})
		await flush()
		release()
		epoch = 5
		await act(() => queryClient.refetchQueries({ queryKey }))
		await flush()

		expect(call).toHaveBeenCalledTimes(1)
	})

	it("does not refresh in the background while the page is hidden", async () => {
		vi.useFakeTimers()
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
		const call = vi.fn(async () => transaction())
		const { result } = renderPrepared(call)

		act(() => {
			result.current.prepare(5n)
		})
		await act(() => vi.advanceTimersByTimeAsync(30_000))

		expect(call).toHaveBeenCalledTimes(1)
	})
})

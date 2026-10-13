import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { useClearLatest } from "./useClearLatest"
import { oracleWriteKeys } from "./useOracleState"

const { clientMock, writerMock } = vi.hoisted(() => ({
	clientMock: { clear_latest: vi.fn() },
	writerMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	navOracleWriter: writerMock,
}))

const renderClearLatest = () => renderWithWallet(useClearLatest)

describe("useClearLatest", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		writerMock.mockResolvedValue(clientMock)
	})

	it("signs clear_latest as the connected wallet and confirms", async () => {
		const gate = deferred<void>()
		clientMock.clear_latest.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn(
				async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
					await gate.promise
					watcher.onSubmitted()
					return {
						getTransactionResponse: { status: "SUCCESS" },
						result: undefined,
					}
				},
			),
		})
		const { result } = renderClearLatest()

		expect(result.current.submit()).toBe(true)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		gate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "confirmed" }),
		)
		expect(clientMock.clear_latest).toHaveBeenCalledWith({
			caller: investorAddress,
		})
	})

	it("refuses before asking for a signature when the simulation carries the contract's reason", async () => {
		const signAndSend = vi.fn()
		clientMock.clear_latest.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #3008)" },
			signAndSend,
		})
		const { result, queryClient } = renderClearLatest()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 3008 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		clientMock.clear_latest.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderClearLatest()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("refreshes the state it changed once confirmed", async () => {
		clientMock.clear_latest.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: undefined,
			}),
		})
		const { result, queryClient } = renderClearLatest()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		for (const queryKey of oracleWriteKeys)
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
	})
})

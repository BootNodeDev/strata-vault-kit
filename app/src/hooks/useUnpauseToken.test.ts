import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { tokenPausedKey } from "./useTokenPaused"
import { useUnpauseToken } from "./useUnpauseToken"

const { clientMock, writerMock } = vi.hoisted(() => ({
	clientMock: { unpause: vi.fn() },
	writerMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	shareTokenWriter: writerMock,
}))

const renderUnpauseToken = () => renderWithWallet(useUnpauseToken)

describe("useUnpauseToken", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		writerMock.mockResolvedValue(clientMock)
	})

	it("signs unpause as the connected wallet and confirms", async () => {
		const gate = deferred<void>()
		clientMock.unpause.mockResolvedValue({
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
		const { result } = renderUnpauseToken()

		expect(result.current.submit()).toBe(true)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		gate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "confirmed" }),
		)
		expect(clientMock.unpause).toHaveBeenCalledWith({ caller: investorAddress })
	})

	it("refuses before asking for a signature when the simulation carries the contract's reason", async () => {
		const signAndSend = vi.fn()
		clientMock.unpause.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #1001)" },
			signAndSend,
		})
		const { result, queryClient } = renderUnpauseToken()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 1001 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		clientMock.unpause.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderUnpauseToken()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("refreshes the state it changed once confirmed", async () => {
		clientMock.unpause.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: undefined,
			}),
		})
		const { result, queryClient } = renderUnpauseToken()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		for (const queryKey of [tokenPausedKey])
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
	})
})

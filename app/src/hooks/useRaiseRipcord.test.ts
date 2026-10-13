import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { oracleWriteKeys } from "./useOracleState"
import { useRaiseRipcord } from "./useRaiseRipcord"

const { clientMock, writerMock } = vi.hoisted(() => ({
	clientMock: { raise_ripcord: vi.fn() },
	writerMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	navOracleWriter: writerMock,
}))

const renderRaiseRipcord = () => renderWithWallet(useRaiseRipcord)

describe("useRaiseRipcord", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		writerMock.mockResolvedValue(clientMock)
	})

	it("signs raise_ripcord as the connected wallet and confirms", async () => {
		const gate = deferred<void>()
		clientMock.raise_ripcord.mockResolvedValue({
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
		const { result } = renderRaiseRipcord()

		expect(result.current.submit()).toBe(true)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		gate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "confirmed" }),
		)
		expect(clientMock.raise_ripcord).toHaveBeenCalledWith({
			caller: investorAddress,
		})
	})

	it("refuses before asking for a signature when the simulation carries the contract's reason", async () => {
		const signAndSend = vi.fn()
		clientMock.raise_ripcord.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #2000)" },
			signAndSend,
		})
		const { result, queryClient } = renderRaiseRipcord()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 2000 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		clientMock.raise_ripcord.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderRaiseRipcord()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("refreshes the state it changed once confirmed", async () => {
		clientMock.raise_ripcord.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: undefined,
			}),
		})
		const { result, queryClient } = renderRaiseRipcord()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		for (const queryKey of oracleWriteKeys)
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
	})
})

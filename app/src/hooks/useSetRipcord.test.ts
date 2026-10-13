import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { oracleWriteKeys } from "./useOracleState"
import { useSetRipcord } from "./useSetRipcord"

const { clientMock, writerMock } = vi.hoisted(() => ({
	clientMock: { set_ripcord: vi.fn() },
	writerMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	navOracleWriter: writerMock,
}))

const renderSetRipcord = () => renderWithWallet(useSetRipcord)

describe("useSetRipcord", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		writerMock.mockResolvedValue(clientMock)
	})

	it("signs set_ripcord as the connected wallet and confirms", async () => {
		const gate = deferred<void>()
		clientMock.set_ripcord.mockResolvedValue({
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
		const { result } = renderSetRipcord()

		expect(result.current.submit(false)).toBe(true)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		gate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "confirmed" }),
		)
		expect(clientMock.set_ripcord).toHaveBeenCalledWith({
			paused: false,
			caller: investorAddress,
		})
	})

	it("refuses before asking for a signature when the simulation carries the contract's reason", async () => {
		const signAndSend = vi.fn()
		clientMock.set_ripcord.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #2000)" },
			signAndSend,
		})
		const { result, queryClient } = renderSetRipcord()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(false))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 2000 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		clientMock.set_ripcord.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderSetRipcord()

		await act(() => result.current.submit(false))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("refreshes the state it changed once confirmed", async () => {
		clientMock.set_ripcord.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: undefined,
			}),
		})
		const { result, queryClient } = renderSetRipcord()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(false))

		for (const queryKey of oracleWriteKeys)
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
	})
})

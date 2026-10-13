import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { usePauseVault } from "./usePauseVault"
import { vaultPausedKey } from "./useVaultPaused"

const { clientMock, writerMock } = vi.hoisted(() => ({
	clientMock: { pause: vi.fn() },
	writerMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: writerMock,
}))

const renderPauseVault = () => renderWithWallet(usePauseVault)

describe("usePauseVault", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		writerMock.mockResolvedValue(clientMock)
	})

	it("signs pause as the connected wallet and confirms", async () => {
		const gate = deferred<void>()
		clientMock.pause.mockResolvedValue({
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
		const { result } = renderPauseVault()

		expect(result.current.submit()).toBe(true)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		gate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "confirmed" }),
		)
		expect(clientMock.pause).toHaveBeenCalledWith({ caller: investorAddress })
	})

	it("refuses before asking for a signature when the simulation carries the contract's reason", async () => {
		const signAndSend = vi.fn()
		clientMock.pause.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #1000)" },
			signAndSend,
		})
		const { result, queryClient } = renderPauseVault()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 1000 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		clientMock.pause.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderPauseVault()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("refreshes the state it changed once confirmed", async () => {
		clientMock.pause.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: { status: "SUCCESS" },
				result: undefined,
			}),
		})
		const { result, queryClient } = renderPauseVault()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		for (const queryKey of [vaultPausedKey])
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
	})
})

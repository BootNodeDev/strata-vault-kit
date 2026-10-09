import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, renderWithWallet } from "./testSupport"
import { useActivateWindDown } from "./useActivateWindDown"
import { cycleWriteKeys } from "./useCycleState"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { activate_wind_down: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const renderActivateWindDown = () => renderWithWallet(useActivateWindDown)

const successful = () => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result: undefined,
	}),
})

describe("useActivateWindDown", () => {
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
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: undefined,
				}
			},
		)
		vaultMock.activate_wind_down.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderActivateWindDown()

		expect(result.current.submit()).toBe(true)

		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		signingGate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "submitted" }),
		)

		confirmGate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "confirmed" }),
		)

		expect(vaultMock.activate_wind_down).toHaveBeenCalledWith()
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.activate_wind_down.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6049)" },
			signAndSend,
		})
		const { result } = renderActivateWindDown()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6049 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.activate_wind_down.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderActivateWindDown()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("ignores a second submission while one is already in flight", async () => {
		const gate = deferred<void>()
		const signAndSend = vi.fn(async () => {
			await gate.promise
			return {
				getTransactionResponse: { status: "SUCCESS" },
				result: undefined,
			}
		})
		vaultMock.activate_wind_down.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderActivateWindDown()

		void result.current.submit()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit()

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.activate_wind_down).toHaveBeenCalledTimes(1)
	})

	it("refreshes the cycle's history, reads, events and figures once the activation confirms", async () => {
		vaultMock.activate_wind_down.mockResolvedValue(successful())
		const { result, queryClient } = renderActivateWindDown()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		for (const queryKey of cycleWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
	})

	it("does not touch the cached cycle when the vault refuses at simulation", async () => {
		vaultMock.activate_wind_down.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6047)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderActivateWindDown()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		expect(invalidateQueries).not.toHaveBeenCalled()
	})
})

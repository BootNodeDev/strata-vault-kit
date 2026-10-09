import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, renderWithWallet } from "./testSupport"
import { cycleWriteKeys } from "./useCycleState"
import { useFinalizeWindDownRound } from "./useFinalizeWindDownRound"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { finalize_wind_down_round: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const credited = 9_000_000_000n

const renderFinalizeWindDownRound = () =>
	renderWithWallet(useFinalizeWindDownRound)

const successful = (result: bigint) => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result,
	}),
})

describe("useFinalizeWindDownRound", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("moves through awaiting signature, submitted, then confirmed with the amount credited to holders, in order", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: credited,
				}
			},
		)
		vaultMock.finalize_wind_down_round.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderFinalizeWindDownRound()

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
			expect(result.current.status).toEqual({
				status: "confirmed",
				credited,
			}),
		)

		expect(vaultMock.finalize_wind_down_round).toHaveBeenCalledWith()
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.finalize_wind_down_round.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6052)" },
			signAndSend,
		})
		const { result } = renderFinalizeWindDownRound()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6052 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.finalize_wind_down_round.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderFinalizeWindDownRound()

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
				result: credited,
			}
		})
		vaultMock.finalize_wind_down_round.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderFinalizeWindDownRound()

		void result.current.submit()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit()

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.finalize_wind_down_round).toHaveBeenCalledTimes(1)
	})

	it("refreshes the cycle's history, reads, events and figures once the round confirms", async () => {
		vaultMock.finalize_wind_down_round.mockResolvedValue(successful(credited))
		const { result, queryClient } = renderFinalizeWindDownRound()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		for (const queryKey of cycleWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
	})

	it("does not touch the cached cycle when the vault refuses at simulation", async () => {
		vaultMock.finalize_wind_down_round.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6050)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderFinalizeWindDownRound()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		expect(invalidateQueries).not.toHaveBeenCalled()
	})
})

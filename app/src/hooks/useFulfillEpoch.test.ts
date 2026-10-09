import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, renderWithWallet } from "./testSupport"
import { cycleWriteKeys } from "./useCycleState"
import { useFulfillEpoch } from "./useFulfillEpoch"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { fulfill_epoch: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const epochId = 4n
const sharePrice = 1_250_000_000_000_000_000n

const renderFulfillEpoch = () => renderWithWallet(useFulfillEpoch)

const successful = (result: bigint) => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result,
	}),
})

describe("useFulfillEpoch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("moves through awaiting signature, submitted, then confirmed with the share price, in order", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: sharePrice,
				}
			},
		)
		vaultMock.fulfill_epoch.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderFulfillEpoch()

		expect(result.current.submit(epochId)).toBe(true)

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
				sharePrice,
			}),
		)

		expect(vaultMock.fulfill_epoch).toHaveBeenCalledWith({
			epoch_id: epochId,
		})
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.fulfill_epoch.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6042)" },
			signAndSend,
		})
		const { result } = renderFulfillEpoch()

		await act(() => result.current.submit(epochId))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6042 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.fulfill_epoch.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderFulfillEpoch()

		await act(() => result.current.submit(epochId))

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
				result: sharePrice,
			}
		})
		vaultMock.fulfill_epoch.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderFulfillEpoch()

		void result.current.submit(epochId)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(epochId)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.fulfill_epoch).toHaveBeenCalledTimes(1)
	})

	it("refreshes the cycle's history, reads, events and figures once the settlement confirms", async () => {
		vaultMock.fulfill_epoch.mockResolvedValue(successful(sharePrice))
		const { result, queryClient } = renderFulfillEpoch()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		for (const queryKey of cycleWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
	})

	it("does not touch the cached cycle when the vault refuses at simulation", async () => {
		vaultMock.fulfill_epoch.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6044)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderFulfillEpoch()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(epochId))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})
})

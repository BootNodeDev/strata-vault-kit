import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { useCloseEpoch } from "./useCloseEpoch"
import { cycleWriteKeys } from "./useCycleState"
import { investorRequestsKey } from "./useInvestorRequests"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { close_epoch: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const renderCloseEpoch = () => renderWithWallet(useCloseEpoch)

const successful = (result: bigint) => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result,
	}),
})

describe("useCloseEpoch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("moves through awaiting signature, submitted, then confirmed with the sealed epoch, in order", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return { getTransactionResponse: { status: "SUCCESS" }, result: 5n }
			},
		)
		vaultMock.close_epoch.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderCloseEpoch()

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
				sealedEpoch: 5n,
			}),
		)

		expect(vaultMock.close_epoch).toHaveBeenCalledWith({
			caller: investorAddress,
		})
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.close_epoch.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6032)" },
			signAndSend,
		})
		const { result } = renderCloseEpoch()

		await act(() => result.current.submit())

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6032 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.close_epoch.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderCloseEpoch()

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
			return { getTransactionResponse: { status: "SUCCESS" }, result: 5n }
		})
		vaultMock.close_epoch.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderCloseEpoch()

		void result.current.submit()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit()

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.close_epoch).toHaveBeenCalledTimes(1)
	})

	it("refreshes the cycle's history, reads, events and figures once the close confirms", async () => {
		vaultMock.close_epoch.mockResolvedValue(successful(5n))
		const { result, queryClient } = renderCloseEpoch()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		for (const queryKey of cycleWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
	})

	it("does not touch the cached cycle when the vault refuses at simulation", async () => {
		vaultMock.close_epoch.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6046)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderCloseEpoch()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit())

		expect(invalidateQueries).not.toHaveBeenCalled()
	})
})

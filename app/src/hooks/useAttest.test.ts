import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { type Price } from "@stellar-scaffold/app-lib"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { attestWriteKeys, useAttest } from "./useAttest"
import { investorRequestsKey } from "./useInvestorRequests"

const { oracleMock, navOracleWriterMock } = vi.hoisted(() => ({
	oracleMock: { attest: vi.fn() },
	navOracleWriterMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	navOracleWriter: navOracleWriterMock,
}))

const attestation = {
	price: 1_040_000_000_000_000_000n as Price,
	expiresAt: 1_700_186_400n,
}

const renderAttest = () => renderWithWallet(useAttest)

const successful = () => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result: undefined,
	}),
})

describe("useAttest", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		navOracleWriterMock.mockResolvedValue(oracleMock)
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
		oracleMock.attest.mockResolvedValue({ simulation: undefined, signAndSend })
		const { result } = renderAttest()

		expect(result.current.submit(attestation)).toBe(true)

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

		expect(oracleMock.attest).toHaveBeenCalledWith({
			report: {
				nav_per_share: attestation.price,
				expires_at: attestation.expiresAt,
				timestamp: 0n,
			},
			caller: investorAddress,
		})
	})

	it("refuses before ever asking for a signature when the simulation carries the oracle's reason", async () => {
		const signAndSend = vi.fn()
		oracleMock.attest.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #3004)" },
			signAndSend,
		})
		const { result } = renderAttest()

		await act(() => result.current.submit(attestation))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 3004 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		oracleMock.attest.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderAttest()

		await act(() => result.current.submit(attestation))

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
		oracleMock.attest.mockResolvedValue({ simulation: undefined, signAndSend })
		const { result } = renderAttest()

		void result.current.submit(attestation)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(attestation)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(oracleMock.attest).toHaveBeenCalledTimes(1)
	})

	it("refreshes the cycle, the latest price and the figures once the attestation confirms", async () => {
		oracleMock.attest.mockResolvedValue(successful())
		const { result, queryClient } = renderAttest()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(attestation))

		for (const queryKey of attestWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["nav", "latest"],
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
	})

	it("does not touch the cached cycle when the oracle refuses at simulation", async () => {
		oracleMock.attest.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #3002)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderAttest()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(attestation))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})
})

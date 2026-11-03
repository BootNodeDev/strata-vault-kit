import { Buffer } from "buffer"
import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { type Price } from "@stellar-scaffold/app-lib"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { attestWriteKeys, useAttest } from "./useAttest"
import { cycleReadsKey } from "./useCycleState"
import { investorRequestsKey } from "./useInvestorRequests"
import { navLatestKey } from "./useNavPrice"

const { oracleMock, navOracleWriterMock, readLedgerTimeMock } = vi.hoisted(
	() => ({
		oracleMock: { attest: vi.fn() },
		navOracleWriterMock: vi.fn(),
		readLedgerTimeMock: vi.fn(),
	}),
)

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	readLedgerTime: readLedgerTimeMock,
}))

vi.mock("../config/clients", () => ({
	navOracleWriter: navOracleWriterMock,
}))

const attestation = {
	price: 1_040_000_000_000_000_000n as Price,
	freshness: 86_400n,
	proofHash: "ab".repeat(32),
	proofUri: "https://example.com/nav.pdf",
}
const wallClock = 1_700_200_000

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
		vi.spyOn(Date, "now").mockReturnValue(wallClock * 1000 + 999)
		navOracleWriterMock.mockResolvedValue(oracleMock)
		readLedgerTimeMock.mockResolvedValue(null)
	})

	it("moves through awaiting signature, submitted, then confirmed, in order, expiring the report a freshness window after the wall clock", async () => {
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
			input: {
				nav_per_share: attestation.price,
				expires_at: BigInt(wallClock) + attestation.freshness,
				proof_hash: Buffer.alloc(32, 0xab),
				proof_uri: "https://example.com/nav.pdf",
			},
			caller: investorAddress,
		})
	})

	it("expires the report a freshness window after the cached ledger time when the wall clock is behind it", async () => {
		const ledgerTime = BigInt(wallClock) + 3_600n
		oracleMock.attest.mockResolvedValue(successful())
		const { result, queryClient } = renderAttest()
		queryClient.setQueryData(cycleReadsKey, { ledgerTime })

		await act(() => result.current.submit(attestation))

		expect(oracleMock.attest).toHaveBeenCalledWith({
			input: expect.objectContaining({
				expires_at: ledgerTime + attestation.freshness,
			}),
			caller: investorAddress,
		})
		expect(readLedgerTimeMock).not.toHaveBeenCalled()
	})

	it("advances a cached ledger time by the time elapsed since it was read", async () => {
		const ledgerTime = BigInt(wallClock) + 3_600n
		const elapsed = 600
		oracleMock.attest.mockResolvedValue(successful())
		const { result, queryClient } = renderAttest()
		queryClient.setQueryData(
			cycleReadsKey,
			{ ledgerTime },
			{ updatedAt: Date.now() - elapsed * 1000 },
		)

		await act(() => result.current.submit(attestation))

		expect(oracleMock.attest).toHaveBeenCalledWith({
			input: expect.objectContaining({
				expires_at: ledgerTime + BigInt(elapsed) + attestation.freshness,
			}),
			caller: investorAddress,
		})
	})

	it("does not age a cached ledger time backwards when the clock moved back since it was read", async () => {
		const ledgerTime = BigInt(wallClock) + 3_600n
		oracleMock.attest.mockResolvedValue(successful())
		const { result, queryClient } = renderAttest()
		queryClient.setQueryData(
			cycleReadsKey,
			{ ledgerTime },
			{ updatedAt: Date.now() + 600_000 },
		)

		await act(() => result.current.submit(attestation))

		expect(oracleMock.attest).toHaveBeenCalledWith({
			input: expect.objectContaining({
				expires_at: ledgerTime + attestation.freshness,
			}),
			caller: investorAddress,
		})
	})

	it("reads ledger time once when none is cached", async () => {
		const ledgerTime = BigInt(wallClock) + 3_600n
		readLedgerTimeMock.mockResolvedValue(ledgerTime)
		oracleMock.attest.mockResolvedValue(successful())
		const { result } = renderAttest()

		await act(() => result.current.submit(attestation))

		expect(oracleMock.attest).toHaveBeenCalledWith({
			input: expect.objectContaining({
				expires_at: ledgerTime + attestation.freshness,
			}),
			caller: investorAddress,
		})
		expect(readLedgerTimeMock).toHaveBeenCalledTimes(1)
	})

	it("sends an empty proof URI when the attester gives none", async () => {
		oracleMock.attest.mockResolvedValue(successful())
		const { result } = renderAttest()

		await act(() => result.current.submit({ ...attestation, proofUri: "" }))

		expect(oracleMock.attest).toHaveBeenCalledWith({
			input: expect.objectContaining({
				proof_hash: Buffer.alloc(32, 0xab),
				proof_uri: "",
			}),
			caller: investorAddress,
		})
		expect(result.current.status.status).toBe("confirmed")
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
			queryKey: navLatestKey,
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
	})

	it("refreshes the cached cycle when the oracle refuses at simulation", async () => {
		oracleMock.attest.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #3002)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderAttest()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(attestation))

		for (const queryKey of attestWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
	})
})

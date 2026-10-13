import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { type Amount } from "@stellar-scaffold/app-lib"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import type * as ContractTransactionModule from "./useContractTransaction"
import { useContractTransaction } from "./useContractTransaction"
import { cycleWriteKeys } from "./useCycleState"
import { depositBalanceKey } from "./useDepositBalance"
import { useFund } from "./useFund"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { fund: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

vi.mock("./useContractTransaction", async (importOriginal) => {
	const actual = await importOriginal<typeof ContractTransactionModule>()
	return {
		...actual,
		useContractTransaction: vi.fn(actual.useContractTransaction),
	}
})

const assets = 1_000_000_000n as Amount

const renderFund = () => renderWithWallet(useFund)

const successful = () => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result: 1_000_000_000n,
	}),
})

describe("useFund", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("moves through awaiting signature, submitted, then confirmed, in order, funding from the connected wallet", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: 1_000_000_000n,
				}
			},
		)
		vaultMock.fund.mockResolvedValue({ simulation: undefined, signAndSend })
		const { result } = renderFund()

		expect(result.current.submit(assets)).toBe(true)

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

		expect(vaultMock.fund).toHaveBeenCalledWith({
			from: investorAddress,
			assets,
		})
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.fund.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6007)" },
			signAndSend,
		})
		const { result } = renderFund()

		await act(() => result.current.submit(assets))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6007 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.fund.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderFund()

		await act(() => result.current.submit(assets))

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
				result: 1_000_000_000n,
			}
		})
		vaultMock.fund.mockResolvedValue({ simulation: undefined, signAndSend })
		const { result } = renderFund()

		void result.current.submit(assets)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(assets)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.fund).toHaveBeenCalledTimes(1)
	})

	it("refreshes the cycle, the figures and the wallet's balance once the funding confirms", async () => {
		vaultMock.fund.mockResolvedValue(successful())
		const { result, queryClient } = renderFund()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(assets))

		for (const queryKey of cycleWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: depositBalanceKey(investorAddress),
		})
	})

	it("refreshes the custodian's balance once the funding confirms", async () => {
		vaultMock.fund.mockResolvedValue(successful())
		const { result, queryClient } = renderFund()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(assets))

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["cycle", "custodianBalance"],
		})
	})

	it("names the funding wallet's balance among the keys it refreshes, keeping submit stable", () => {
		const { result, rerender } = renderFund()
		const firstSubmit = result.current.submit

		rerender()

		const extraKeys = vi.mocked(useContractTransaction).mock.lastCall?.[2]
		expect(extraKeys).toContainEqual(depositBalanceKey(investorAddress))
		expect(result.current.submit).toBe(firstSubmit)
	})

	it("does not touch the cached cycle when the vault refuses at simulation", async () => {
		vaultMock.fund.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6014)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderFund()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(assets))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})
})

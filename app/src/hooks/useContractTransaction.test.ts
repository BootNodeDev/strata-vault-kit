import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { investorAddress, renderWithWallet } from "./testSupport"
import { useContractTransaction } from "./useContractTransaction"
import { investorRequestsKey } from "./useInvestorRequests"

const extraKeys = [
	["cycle", "history"],
	["vault", "figures"],
] as const

const transaction = (simulationError?: string) =>
	({
		simulation:
			simulationError === undefined ? undefined : { error: simulationError },
		signAndSend: vi.fn().mockResolvedValue({
			getTransactionResponse: { status: "SUCCESS" },
			result: 1n,
		}),
	}) as unknown as AssembledTransaction<bigint>

const renderTransaction = (simulationError?: string) =>
	renderWithWallet(() =>
		useContractTransaction(
			async () => transaction(simulationError),
			(result: bigint) => ({ result }),
			extraKeys,
		),
	)

describe("useContractTransaction", () => {
	it("refreshes the extra query keys alongside the investor's once the transaction confirms", async () => {
		const { result, queryClient } = renderTransaction()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(result.current.status).toEqual({ status: "confirmed", result: 1n })
		for (const queryKey of extraKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: investorRequestsKey(investorAddress),
		})
	})

	it("leaves every cache alone when the vault refuses at simulation", async () => {
		const { result, queryClient } = renderTransaction(
			"HostError: Error(Contract, #6046)",
		)
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})

	it("refreshes only the investor's caches when no extra keys are given", async () => {
		const { result, queryClient } = renderWithWallet(() =>
			useContractTransaction(
				async () => transaction(),
				(result: bigint) => ({ result }),
			),
		)
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(invalidateQueries).toHaveBeenCalledTimes(3)
	})
})

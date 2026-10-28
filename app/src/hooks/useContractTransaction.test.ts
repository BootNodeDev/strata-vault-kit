import { xdr } from "@stellar/stellar-sdk"
import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { type TransactionEvent } from "@stellar-scaffold/app-lib"
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
	it("hands the confirmed transaction's contract events to its confirmation", async () => {
		const surrendered = new xdr.ContractEvent({
			ext: new xdr.ExtensionPoint(0),
			contractId: null,
			type: xdr.ContractEventType.contract(),
			body: new xdr.ContractEventBody(
				0,
				new xdr.ContractEventV0({
					topics: [xdr.ScVal.scvSymbol("redemption_surrendered")],
					data: xdr.ScVal.scvVoid(),
				}),
			),
		})
		const tx = {
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue({
				getTransactionResponse: {
					status: "SUCCESS",
					events: {
						transactionEventsXdr: [],
						contractEventsXdr: [[surrendered]],
					},
				},
				result: 1n,
			}),
		} as unknown as AssembledTransaction<bigint>
		const { result } = renderWithWallet(() =>
			useContractTransaction(
				async () => tx,
				(_result: bigint, events: TransactionEvent[]) => ({
					names: events.map((event) => event.name),
				}),
			),
		)

		await act(() => result.current.submit(undefined))

		expect(result.current.status).toEqual({
			status: "confirmed",
			names: ["redemption_surrendered"],
		})
	})

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

	it("refreshes only the extra query keys when the contract refuses at simulation", async () => {
		const { result, queryClient } = renderTransaction(
			"HostError: Error(Contract, #6046)",
		)
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(invalidateQueries).toHaveBeenCalledTimes(extraKeys.length)
		for (const queryKey of extraKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
	})

	it("keeps the same submit across rerenders when no extra keys are given", () => {
		const call = async () => transaction()
		const toConfirmed = (result: bigint) => ({ result })
		const { result, rerender } = renderWithWallet(() =>
			useContractTransaction(call, toConfirmed),
		)
		const { submit } = result.current

		rerender()

		expect(result.current.submit).toBe(submit)
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

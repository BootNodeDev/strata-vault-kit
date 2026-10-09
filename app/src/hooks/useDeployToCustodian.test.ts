import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { type Amount } from "@stellar-scaffold/app-lib"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { cycleWriteKeys } from "./useCycleState"
import { useDeployToCustodian } from "./useDeployToCustodian"

const { vaultMock, asyncVaultWriterMock } = vi.hoisted(() => ({
	vaultMock: { deploy_to_custodian: vi.fn() },
	asyncVaultWriterMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
}))

const assets = 2_500_000_000n as Amount

const renderDeploy = () => renderWithWallet(useDeployToCustodian)

const successful = () => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result: 4_500_000_000n,
	}),
})

describe("useDeployToCustodian", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vaultMock)
	})

	it("moves through awaiting signature, submitted, then confirmed, in order, deploying as the connected wallet", async () => {
		const signingGate = deferred<void>()
		const confirmGate = deferred<void>()
		const signAndSend = vi.fn(
			async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
				await signingGate.promise
				watcher.onSubmitted()
				await confirmGate.promise
				return {
					getTransactionResponse: { status: "SUCCESS" },
					result: 4_500_000_000n,
				}
			},
		)
		vaultMock.deploy_to_custodian.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderDeploy()

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

		expect(vaultMock.deploy_to_custodian).toHaveBeenCalledWith({
			caller: investorAddress,
			assets,
		})
	})

	it("refuses before ever asking for a signature when the simulation carries the vault's reason", async () => {
		const signAndSend = vi.fn()
		vaultMock.deploy_to_custodian.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6005)" },
			signAndSend,
		})
		const { result } = renderDeploy()

		await act(() => result.current.submit(assets))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6005 },
		})
		expect(signAndSend).not.toHaveBeenCalled()
	})

	it("tells a declined signature apart from a failure", async () => {
		vaultMock.deploy_to_custodian.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderDeploy()

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
				result: 4_500_000_000n,
			}
		})
		vaultMock.deploy_to_custodian.mockResolvedValue({
			simulation: undefined,
			signAndSend,
		})
		const { result } = renderDeploy()

		void result.current.submit(assets)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		void result.current.submit(assets)

		gate.resolve()
		await waitFor(() => expect(result.current.status.status).toBe("confirmed"))

		expect(vaultMock.deploy_to_custodian).toHaveBeenCalledTimes(1)
	})

	it("refreshes the cycle and the figures once the deployment confirms", async () => {
		vaultMock.deploy_to_custodian.mockResolvedValue(successful())
		const { result, queryClient } = renderDeploy()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(assets))

		for (const queryKey of cycleWriteKeys) {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		}
	})

	it("does not touch the cached cycle when the vault refuses at simulation", async () => {
		vaultMock.deploy_to_custodian.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6012)" },
			signAndSend: vi.fn(),
		})
		const { result, queryClient } = renderDeploy()
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(assets))

		expect(invalidateQueries).not.toHaveBeenCalled()
	})
})

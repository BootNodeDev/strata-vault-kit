import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import {
	useClearLatest,
	usePauseToken,
	usePauseVault,
	useRaiseRipcord,
	useSetRipcord,
	useUnpauseToken,
	useUnpauseVault,
} from "./useEmergencyTransactions"
import { oracleWriteKeys } from "./useOracleState"
import { tokenPausedKey } from "./useTokenPaused"
import { vaultPausedKey } from "./useVaultPaused"

const { vault, token, oracle } = vi.hoisted(() => ({
	vault: { pause: vi.fn(), unpause: vi.fn() },
	token: { pause: vi.fn(), unpause: vi.fn() },
	oracle: {
		raise_ripcord: vi.fn(),
		set_ripcord: vi.fn(),
		clear_latest: vi.fn(),
	},
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: async () => vault,
	shareTokenWriter: async () => token,
	navOracleWriter: async () => oracle,
}))

type Case = {
	name: string
	useHook: () => {
		status: unknown
		submit: (arg: never) => boolean
	}
	method: ReturnType<typeof vi.fn>
	arg: unknown
	args: object
	keys: readonly (readonly string[])[]
	refusal: number
}

const cases: Case[] = [
	{
		name: "usePauseVault",
		useHook: usePauseVault,
		method: vault.pause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [vaultPausedKey],
		refusal: 1000,
	},
	{
		name: "useUnpauseVault",
		useHook: useUnpauseVault,
		method: vault.unpause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [vaultPausedKey],
		refusal: 1001,
	},
	{
		name: "usePauseToken",
		useHook: usePauseToken,
		method: token.pause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [tokenPausedKey],
		refusal: 1000,
	},
	{
		name: "useUnpauseToken",
		useHook: useUnpauseToken,
		method: token.unpause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [tokenPausedKey],
		refusal: 1001,
	},
	{
		name: "useRaiseRipcord",
		useHook: useRaiseRipcord,
		method: oracle.raise_ripcord,
		arg: undefined,
		args: { caller: investorAddress },
		keys: oracleWriteKeys,
		refusal: 2000,
	},
	{
		name: "useClearLatest",
		useHook: useClearLatest,
		method: oracle.clear_latest,
		arg: undefined,
		args: { caller: investorAddress },
		keys: oracleWriteKeys,
		refusal: 3008,
	},
	{
		name: "useSetRipcord",
		useHook: useSetRipcord,
		method: oracle.set_ripcord,
		arg: false,
		args: { paused: false, caller: investorAddress },
		keys: oracleWriteKeys,
		refusal: 2000,
	},
]

const confirmed = () => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result: undefined,
	}),
})

describe.each(cases)("$name", (testCase) => {
	const { useHook, method, arg, args, keys, refusal } = testCase

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("signs as the connected wallet and confirms", async () => {
		const gate = deferred<void>()
		method.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn(
				async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
					await gate.promise
					watcher.onSubmitted()
					return {
						getTransactionResponse: { status: "SUCCESS" },
						result: undefined,
					}
				},
			),
		})
		const { result } = renderWithWallet(useHook)

		expect(result.current.submit(arg as never)).toBe(true)
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "awaiting-signature" }),
		)

		gate.resolve()
		await waitFor(() =>
			expect(result.current.status).toEqual({ status: "confirmed" }),
		)
		expect(method).toHaveBeenCalledWith(args)
	})

	it("refuses before asking for a signature and refreshes the state it read", async () => {
		const signAndSend = vi.fn()
		method.mockResolvedValue({
			simulation: { error: `HostError: Error(Contract, #${refusal})` },
			signAndSend,
		})
		const { result, queryClient } = renderWithWallet(useHook)
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(arg as never))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: refusal },
		})
		expect(signAndSend).not.toHaveBeenCalled()
		for (const queryKey of keys)
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
	})

	it("tells a declined signature apart from a failure", async () => {
		method.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		})
		const { result } = renderWithWallet(useHook)

		await act(() => result.current.submit(arg as never))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "declined" },
		})
	})

	it("refreshes the state it changed once confirmed", async () => {
		method.mockResolvedValue(confirmed())
		const { result, queryClient } = renderWithWallet(useHook)
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(arg as never))

		for (const queryKey of keys)
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
	})
})

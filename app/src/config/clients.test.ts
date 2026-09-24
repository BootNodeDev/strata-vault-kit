import type * as AppLib from "@stellar-scaffold/app-lib"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { connectAsyncVaultMock } = vi.hoisted(() => ({
	connectAsyncVaultMock: vi.fn(),
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => {
	const actual = await importOriginal<typeof AppLib>()
	return { ...actual, connectAsyncVault: connectAsyncVaultMock }
})

describe("asyncVaultWriter", () => {
	beforeEach(() => {
		vi.resetModules()
		connectAsyncVaultMock.mockReset()
	})

	it("builds a writing client carrying the connected address and signer", async () => {
		const client = {}
		connectAsyncVaultMock.mockResolvedValue(client)
		const signTransaction = vi.fn()
		const { asyncVaultWriter } = await import("./clients")

		const result = await asyncVaultWriter({
			publicKey: "GONE",
			signTransaction,
		})

		expect(result).toBe(client)
		expect(connectAsyncVaultMock).toHaveBeenCalledWith(expect.any(String), {
			publicKey: "GONE",
			signTransaction,
		})
	})

	it("does not hand back a client bound to the previous address once it switches", async () => {
		const clientOne = {}
		const clientTwo = {}
		connectAsyncVaultMock
			.mockResolvedValueOnce(clientOne)
			.mockResolvedValueOnce(clientTwo)
		const { asyncVaultWriter } = await import("./clients")

		const first = await asyncVaultWriter({
			publicKey: "GONE",
			signTransaction: vi.fn(),
		})
		const second = await asyncVaultWriter({
			publicKey: "GTWO",
			signTransaction: vi.fn(),
		})

		expect(first).toBe(clientOne)
		expect(second).toBe(clientTwo)
		expect(connectAsyncVaultMock).toHaveBeenCalledTimes(2)
	})

	it("reuses the pending client instead of reconnecting for the same address", async () => {
		connectAsyncVaultMock.mockResolvedValue({})
		const signTransaction = vi.fn()
		const { asyncVaultWriter } = await import("./clients")

		await Promise.all([
			asyncVaultWriter({ publicKey: "GONE", signTransaction }),
			asyncVaultWriter({ publicKey: "GONE", signTransaction }),
		])

		expect(connectAsyncVaultMock).toHaveBeenCalledTimes(1)
	})
})

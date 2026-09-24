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

	it("does not hand back a client built with a stale signTransaction once the same address reconnects with a new one", async () => {
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
			publicKey: "GONE",
			signTransaction: vi.fn(),
		})

		expect(first).toBe(clientOne)
		expect(second).toBe(clientTwo)
		expect(connectAsyncVaultMock).toHaveBeenCalledTimes(2)
	})

	it("does not let a superseded connect's rejection evict a newer entry for the same address", async () => {
		const deferredOne = deferred<AppLib.AsyncVaultApi>()
		const clientThree = {}
		connectAsyncVaultMock
			.mockReturnValueOnce(deferredOne.promise)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce(clientThree)
		const { asyncVaultWriter } = await import("./clients")
		const signerA = { publicKey: "GONE", signTransaction: vi.fn() }
		const signerB = { publicKey: "GTWO", signTransaction: vi.fn() }

		const first = asyncVaultWriter(signerA)
		first.catch(() => {})
		await asyncVaultWriter(signerB)
		const third = await asyncVaultWriter(signerA)

		deferredOne.reject(new Error("stale"))
		await Promise.resolve()
		const fourth = await asyncVaultWriter(signerA)

		expect(third).toBe(clientThree)
		expect(fourth).toBe(clientThree)
		expect(connectAsyncVaultMock).toHaveBeenCalledTimes(3)
	})
})

const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

import {
	Account,
	BASE_FEE,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
	xdr,
} from "@stellar/stellar-sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { submitSigned } from "./multisig"
import { readLedgerTime } from "./readContract"
import { server } from "./rpc"

const fetchMock = vi.fn<typeof fetch>()

const answer = (result: unknown) =>
	Promise.resolve(
		new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
			headers: { "content-type": "application/json" },
		}),
	)

const stall: typeof fetch = (_, init) =>
	new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
	})

const health = {
	status: "healthy",
	latestLedger: 100,
	latestLedgerCloseTime: "1700000000",
	oldestLedger: 1,
	ledgerRetentionWindow: 120_960,
}

const transaction = () =>
	new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), {
		fee: BASE_FEE,
		networkPassphrase: Networks.TESTNET,
	})
		.addOperation(Operation.bumpSequence({ bumpTo: "2" }))
		.setTimeout(0)
		.build()

const pending = {
	status: "PENDING",
	hash: "abc",
	latestLedger: 100,
	latestLedgerCloseTime: 1_700_000_000,
}

const landed = (submitted: ReturnType<typeof transaction>) => ({
	status: "SUCCESS",
	latestLedger: 101,
	latestLedgerCloseTime: "1700000005",
	oldestLedger: 1,
	oldestLedgerCloseTime: "1690000000",
	ledger: 101,
	createdAt: "1700000005",
	applicationOrder: 1,
	feeBump: false,
	envelopeXdr: submitted.toEnvelope().toXDR("base64"),
	resultXdr: new xdr.TransactionResult({
		feeCharged: xdr.Int64.fromString("100"),
		result: xdr.TransactionResultResult.txSuccess([]),
		ext: new xdr.TransactionResultExt(0),
	}).toXDR("base64"),
	resultMetaXdr: new xdr.TransactionMeta(0, []).toXDR("base64"),
})

const later = (response: Promise<Response>, ms: number) =>
	new Promise<Response>((resolve) => {
		setTimeout(() => resolve(response), ms)
	})

describe("rpc server", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		fetchMock.mockReset()
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it("retries a read that stalls past 3 s and answers from the retry", async () => {
		fetchMock.mockImplementationOnce(stall)
		fetchMock.mockImplementationOnce(() => answer(health))

		const read = server.getHealth()
		await vi.advanceTimersByTimeAsync(3_000)

		await expect(read).resolves.toEqual(health)
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("still resolves a read that stalls on the first attempt and again on the retry", async () => {
		fetchMock.mockImplementationOnce(stall)
		fetchMock.mockImplementationOnce(() => later(answer(health), 10_000))

		const read = readLedgerTime()
		await vi.advanceTimersByTimeAsync(13_000)

		await expect(read).resolves.toBe(1_700_000_000n)
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not cut the retry at 3 s", async () => {
		fetchMock.mockImplementation(stall)
		let settled = false
		void server.getHealth().finally(() => {
			settled = true
		})

		await vi.advanceTimersByTimeAsync(33_000)

		expect(settled).toBe(false)
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("retries a read once after a network failure", async () => {
		fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
		fetchMock.mockImplementationOnce(() => answer(health))

		await expect(server.getHealth()).resolves.toEqual(health)
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("does not retry a read the RPC refused with an HTTP status", async () => {
		fetchMock.mockResolvedValue(new Response("slow down", { status: 429 }))

		await expect(server.getHealth()).rejects.toThrow("429")
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("waits out a slow status poll after a submission instead of reporting it failed", async () => {
		const submitted = transaction()
		fetchMock.mockImplementationOnce(() => answer(pending))
		fetchMock.mockImplementationOnce(() =>
			later(answer(landed(submitted)), 10_000),
		)

		const submission = submitSigned(submitted)
		await vi.advanceTimersByTimeAsync(10_000)

		await expect(submission).resolves.toMatchObject({ status: "success" })
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("neither times out nor retries a transaction submission", async () => {
		fetchMock.mockImplementationOnce(() => later(answer(pending), 5_000))

		const submission = server.sendTransaction(transaction())
		await vi.advanceTimersByTimeAsync(5_000)

		await expect(submission).resolves.toMatchObject({ hash: "abc" })
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("does not retry a failed transaction submission", async () => {
		fetchMock.mockRejectedValue(new Error("network down"))

		await expect(server.sendTransaction(transaction())).rejects.toThrow(
			"network down",
		)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})

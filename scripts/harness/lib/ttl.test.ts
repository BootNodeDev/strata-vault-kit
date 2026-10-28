import { describe, expect, it } from "vitest"

import {
	CONTRACT_A,
	RPC,
	WASM_HASH,
	codeData,
	fetchOutput,
	instanceData,
} from "./fake-ledger.js"
import {
	extend,
	inspect,
	latestLedger,
	wasmHashOf,
	type Entry,
	type Runner,
} from "./ttl.js"

// Captured verbatim from a quickstart RPC (CLI 27, protocol 28).
const SAC_INSTANCE_FETCH =
	'{"entries":[{"key":"AAAABgAAAAHYsrFMYP7LZfsqqBy+p50INcr8Dg2FH4YRJXweW0HhwgAAABQAAAAB","xdr":"AAAABgAAAAAAAAAB2LKxTGD+y2X7KqgcvqedCDXK/A4NhR+GESV8HltB4cIAAAAUAAAAAQAAABMAAAABAAAAAQAAAAIAAAAPAAAACE1FVEFEQVRBAAAAEQAAAAEAAAADAAAADwAAAAdkZWNpbWFsAAAAAAMAAAAHAAAADwAAAARuYW1lAAAADgAAAAZuYXRpdmUAAAAAAA8AAAAGc3ltYm9sAAAAAAAOAAAABm5hdGl2ZQAAAAAAEAAAAAEAAAABAAAADwAAAAlBc3NldEluZm8AAAAAAAAQAAAAAQAAAAEAAAAPAAAABk5hdGl2ZQAA","lastModifiedLedgerSeq":173,"liveUntilLedgerSeq":121132}],"latestLedger":174}'

const run =
	(output: string): Runner =>
	() =>
		Promise.resolve(output)

describe("inspect", () => {
	it("reads a live Stellar Asset Contract instance from the CLI's XDR output", async () => {
		const result = await inspect(
			RPC,
			{ id: CONTRACT_A },
			run(SAC_INSTANCE_FETCH),
		)

		expect(result.archived).toBe(false)
		expect(result.found).toBe(true)
		expect(wasmHashOf(result.instance!)).toBeUndefined()
	})

	it("counts an entry the RPC does not return as archived", async () => {
		const result = await inspect(
			RPC,
			{ id: CONTRACT_A },
			run('{"entries":[],"latestLedger":174}'),
		)

		expect(result).toEqual({
			archived: true,
			found: false,
			instance: undefined,
		})
	})

	it("counts an entry whose live-until ledger has passed as archived", async () => {
		const expired = SAC_INSTANCE_FETCH.replace(
			'"liveUntilLedgerSeq":121132',
			'"liveUntilLedgerSeq":0',
		).replace('"latestLedger":174', '"latestLedger":300')

		const result = await inspect(RPC, { id: CONTRACT_A }, run(expired))

		expect(result.archived).toBe(true)
		expect(result.found).toBe(true)
		expect(result.instance).toBeDefined()
	})

	it("counts an entry live through the latest ledger as live", async () => {
		const output = fetchOutput(500, [
			{
				xdr: instanceData(CONTRACT_A, { wasmHash: WASM_HASH }),
				liveUntilLedgerSeq: 500,
			},
		])

		const result = await inspect(RPC, { id: CONTRACT_A }, run(output))

		expect(result.archived).toBe(false)
		expect(wasmHashOf(result.instance!)).toBe(WASM_HASH)
	})

	it("asks the CLI for the RPC's XDR output", async () => {
		const calls: string[][] = []
		const capture: Runner = (args) => {
			calls.push([...args])
			return Promise.resolve('{"entries":[],"latestLedger":1}')
		}

		await inspect(RPC, { id: CONTRACT_A }, capture)
		await inspect(RPC, { id: CONTRACT_A, keyXdr: "K" }, capture)
		await inspect(RPC, { wasmHash: WASM_HASH }, capture)

		expect(calls[0]).toEqual(
			expect.arrayContaining(["--instance", "--output", "xdr"]),
		)
		expect(calls[1]).toEqual(
			expect.arrayContaining(["--key-xdr", "K", "--output", "xdr"]),
		)
		expect(calls[2]).toEqual(
			expect.arrayContaining([
				"contract-code",
				"--wasm-hash",
				WASM_HASH,
				"--output",
				"xdr",
			]),
		)
	})

	const instanceEntry: Entry = { id: CONTRACT_A }
	const badShapes = [
		{ name: "not json", output: "not json" },
		{ name: "no entries array", output: '{"entries":[]}' },
		{
			name: "entries not an array",
			output: '{"entries":{},"latestLedger":1}',
		},
		{
			name: "an entry with unreadable xdr",
			output: fetchOutput(1, [{ xdr: "AAAA", liveUntilLedgerSeq: 1 }]),
		},
		{
			name: "an entry with no live-until ledger",
			output: JSON.stringify({
				entries: [{ xdr: instanceData(CONTRACT_A, {}) }],
				latestLedger: 1,
			}),
		},
		{
			name: "two entries",
			output: fetchOutput(1, [
				{ xdr: instanceData(CONTRACT_A, {}), liveUntilLedgerSeq: 1 },
				{ xdr: instanceData(CONTRACT_A, {}), liveUntilLedgerSeq: 1 },
			]),
		},
		{
			name: "an instance fetch answered with contract code",
			output: fetchOutput(1, [
				{ xdr: codeData(WASM_HASH), liveUntilLedgerSeq: 1 },
			]),
		},
	]

	it.each(badShapes)(
		"names the command when the fetch output has another shape: $name",
		async ({ output }) => {
			await expect(inspect(RPC, instanceEntry, run(output))).rejects.toThrow(
				/stellar ledger entry fetch/,
			)
		},
	)
})

describe("extend", () => {
	it("returns the live-until ledger it prints", async () => {
		await expect(
			extend(RPC, { id: CONTRACT_A }, 100, run("1311")),
		).resolves.toBe(1311)
	})

	it.each(["", "done", "12.5"])(
		"names the command when it prints no live-until ledger: %j",
		async (output) => {
			await expect(
				extend(RPC, { id: CONTRACT_A }, 100, run(output)),
			).rejects.toThrow(/stellar contract extend/)
		},
	)

	it("refuses a live-until ledger of 0, which the CLI prints for an archived entry", async () => {
		await expect(
			extend(RPC, { id: CONTRACT_A }, 100, run("0")),
		).rejects.toThrow(/still archived/)
	})
})

describe("latestLedger", () => {
	it("reads the ledger sequence", async () => {
		await expect(
			latestLedger(RPC, run('{"id":"x","protocolVersion":28,"sequence":175}')),
		).resolves.toBe(175)
	})

	it("names the command when the sequence is missing", async () => {
		await expect(latestLedger(RPC, run('{"id":"x"}'))).rejects.toThrow(
			/stellar ledger latest/,
		)
	})
})

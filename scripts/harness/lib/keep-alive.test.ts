import { describe, expect, it } from "vitest"

import {
	CONTRACT_A,
	FakeLedger,
	RPC,
	WASM_HASH,
	entryKey,
	instanceData,
} from "./fake-ledger.js"
import { keepAlive } from "./keep-alive.js"
import { wasmHashOf } from "./ttl.js"

const steps = (ledger: FakeLedger) =>
	ledger.calls.map((args) => args.slice(0, 2).join(" "))

describe("keepAlive", () => {
	it("extends a live entry without restoring it", async () => {
		const ledger = new FakeLedger()
		const lines: string[] = []
		ledger.put(
			entryKey({ id: CONTRACT_A }),
			instanceData(CONTRACT_A, { wasmHash: WASM_HASH }),
			2000,
		)

		await keepAlive(
			RPC,
			{ id: CONTRACT_A },
			"vault instance",
			ledger.run,
			(l) => lines.push(l),
		)

		expect(steps(ledger)).toEqual(["ledger entry", "contract extend"])
		expect(lines).toEqual(["vault instance live until ledger 519400"])
	})

	it.each(["absent", "expired"] as const)(
		"restores an archived entry the RPC answers as %s, then extends it",
		async (whenArchived) => {
			const ledger = new FakeLedger()
			const lines: string[] = []
			ledger.put(
				entryKey({ id: CONTRACT_A }),
				instanceData(CONTRACT_A, { wasmHash: WASM_HASH }),
				900,
				whenArchived,
			)

			const instance = await keepAlive(
				RPC,
				{ id: CONTRACT_A },
				"vault instance",
				ledger.run,
				(l) => lines.push(l),
			)

			expect(steps(ledger)).toEqual([
				"ledger entry",
				"contract restore",
				"ledger entry",
				"contract extend",
			])
			expect(lines).toEqual([
				"vault instance restored",
				"vault instance live until ledger 519400",
			])
			expect(wasmHashOf(instance!)).toBe(WASM_HASH)
		},
	)

	it("stops when the RPC has no entry, live or archived", async () => {
		const ledger = new FakeLedger()
		const lines: string[] = []

		let error: unknown
		try {
			await keepAlive(
				RPC,
				{ id: CONTRACT_A },
				"vault instance",
				ledger.run,
				(l) => lines.push(l),
			)
		} catch (caught) {
			error = caught
		}

		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toMatch(
			/no entry for it, live or archived/,
		)
		expect((error as Error).message).toContain(RPC.rpcUrl)
	})

	it("stops when an entry is still archived after its restore", async () => {
		const ledger = new FakeLedger()
		const lines: string[] = []
		ledger.put(
			entryKey({ id: CONTRACT_A }),
			instanceData(CONTRACT_A, { wasmHash: WASM_HASH }),
			900,
		)
		ledger.restoreDoesNothing = true

		await expect(
			keepAlive(RPC, { id: CONTRACT_A }, "vault instance", ledger.run, (l) =>
				lines.push(l),
			),
		).rejects.toThrow(/still archived after the restore/)
	})
})

import { xdr } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import {
	CONTRACT_A,
	CONTRACT_B,
	CONTRACT_C,
	FakeLedger,
	RPC,
	WASM_HASH,
	codeData,
	entryKey,
	instanceData,
	pendingData,
} from "./fake-ledger.js"
import { keepAlive, keepDeploymentAlive, type Log } from "./keep-alive.js"
import { openChangesKey, pendingChangeKey } from "./timelock-keys.js"
import { wasmHashOf } from "./ttl.js"

const steps = (ledger: FakeLedger) =>
	ledger.calls.map((args) => args.slice(0, 2).join(" "))

const open = (...ids: number[]): xdr.ScMapEntry =>
	new xdr.ScMapEntry({
		key: openChangesKey(),
		val: xdr.ScVal.scvVec(ids.map((id) => xdr.ScVal.scvU32(id))),
	})

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

describe("keepDeploymentAlive", () => {
	it("keeps alive each instance, the Wasm it runs once per hash, and each open change", async () => {
		const ledger = new FakeLedger()
		const lines: string[] = []
		const log: Log = (l) => lines.push(l)

		ledger.put(
			entryKey({ id: CONTRACT_A }),
			instanceData(CONTRACT_A, { wasmHash: WASM_HASH, storage: [open(1, 2)] }),
			2000,
		)
		ledger.put(
			entryKey({ id: CONTRACT_B }),
			instanceData(CONTRACT_B, { wasmHash: WASM_HASH }),
			2000,
		)
		ledger.put(entryKey({ id: CONTRACT_C }), instanceData(CONTRACT_C, {}), 2000)
		ledger.put(entryKey({ wasmHash: WASM_HASH }), codeData(WASM_HASH), 2000)
		ledger.put(
			entryKey({
				id: CONTRACT_A,
				keyXdr: pendingChangeKey(1).toXDR("base64"),
			}),
			pendingData(CONTRACT_A, pendingChangeKey(1).toXDR("base64")),
			2000,
		)
		ledger.put(
			entryKey({
				id: CONTRACT_A,
				keyXdr: pendingChangeKey(2).toXDR("base64"),
			}),
			pendingData(CONTRACT_A, pendingChangeKey(2).toXDR("base64")),
			900,
			"absent",
		)

		await keepDeploymentAlive(
			RPC,
			[
				["vault", CONTRACT_A],
				["oracle", CONTRACT_B],
				["asset", CONTRACT_C],
			],
			ledger.run,
			log,
		)

		expect(lines).toEqual([
			"vault instance live until ledger 519400",
			"oracle instance live until ledger 519400",
			"asset instance live until ledger 519400",
			`code ${WASM_HASH.slice(0, 8)} live until ledger 519400`,
			"vault pending change 1 live until ledger 519400",
			"vault pending change 2 restored",
			"vault pending change 2 live until ledger 519400",
		])
		const restored = ledger.calls.find((a) => a[1] === "restore")
		expect(restored).toContain(pendingChangeKey(2).toXDR("base64"))
		expect(
			ledger.calls
				.filter((a) => a.includes("--key-xdr"))
				.every((a) => a.includes(CONTRACT_A)),
		).toBe(true)
	})

	it("reads open changes from an instance restored from archive", async () => {
		const ledger = new FakeLedger()
		const lines: string[] = []
		const log: Log = (l) => lines.push(l)

		ledger.put(
			entryKey({ id: CONTRACT_A }),
			instanceData(CONTRACT_A, { wasmHash: WASM_HASH, storage: [open(3)] }),
			900,
			"absent",
		)
		ledger.put(entryKey({ wasmHash: WASM_HASH }), codeData(WASM_HASH), 2000)
		ledger.put(
			entryKey({
				id: CONTRACT_A,
				keyXdr: pendingChangeKey(3).toXDR("base64"),
			}),
			pendingData(CONTRACT_A, pendingChangeKey(3).toXDR("base64")),
			2000,
		)

		await keepDeploymentAlive(RPC, [["vault", CONTRACT_A]], ledger.run, log)

		expect(lines).toContain("vault instance restored")
		expect(lines).toContain("vault pending change 3 live until ledger 519400")
	})
})

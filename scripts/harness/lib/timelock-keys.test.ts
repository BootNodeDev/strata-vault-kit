import { readFileSync } from "node:fs"
import { join } from "node:path"

import { xdr } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { REPO_ROOT } from "./deployment.js"
import {
	openChangeIds,
	openChangesKey,
	pendingChangeKey,
} from "./timelock-keys.js"

const FIXTURE = join(REPO_ROOT, "fixtures", "timelock-storage-keys.txt")

function fixtureLines(): Array<[string, string]> {
	return readFileSync(FIXTURE, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "" && !line.startsWith("#"))
		.map((line): [string, string] => {
			const at = line.indexOf(" ")
			if (at === -1) throw new Error(`${FIXTURE}: malformed line ${line}`)
			return [line.slice(0, at), line.slice(at + 1)]
		})
}

function instance(storage: xdr.ScMapEntry[] | null): xdr.ScContractInstance {
	return new xdr.ScContractInstance({
		executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
		storage,
	})
}

describe("timelock storage keys", () => {
	it("builds every key the way the timelock crate encodes it", () => {
		const lines = fixtureLines()
		expect(lines.some(([name]) => name === "TimelockOpen")).toBe(true)
		expect(lines.some(([name]) => name.startsWith("TimelockPending("))).toBe(
			true,
		)
		for (const [name, hex] of lines) {
			const key =
				name === "TimelockOpen"
					? openChangesKey()
					: pendingChangeKey(
							Number(/^TimelockPending\((\d+)\)$/.exec(name)?.[1] ?? NaN),
						)
			expect(key.toXDR("hex")).toBe(hex)
		}
	})
})

describe("openChangeIds", () => {
	it("reads the open ids from instance storage", () => {
		const storage = [
			new xdr.ScMapEntry({
				key: openChangesKey(),
				val: xdr.ScVal.scvVec([xdr.ScVal.scvU32(3), xdr.ScVal.scvU32(7)]),
			}),
			new xdr.ScMapEntry({
				key: xdr.ScVal.scvSymbol("Other"),
				val: xdr.ScVal.scvU32(1),
			}),
		]

		expect(openChangeIds(instance(storage))).toEqual([3, 7])
	})

	it("finds no open ids in a contract that never queued a change", () => {
		const withoutKey = instance([
			new xdr.ScMapEntry({
				key: xdr.ScVal.scvSymbol("Other"),
				val: xdr.ScVal.scvU32(1),
			}),
		])
		const withNullStorage = instance(null)

		expect(openChangeIds(withoutKey)).toEqual([])
		expect(openChangeIds(withNullStorage)).toEqual([])
	})

	it("refuses an open-ids entry of another shape", () => {
		const badShape = instance([
			new xdr.ScMapEntry({ key: openChangesKey(), val: xdr.ScVal.scvU32(1) }),
		])

		expect(() => openChangeIds(badShape)).toThrow(/TimelockOpen/)
	})
})

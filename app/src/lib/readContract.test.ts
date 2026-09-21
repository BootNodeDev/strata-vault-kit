import { describe, expect, it } from "vitest"
import { readContract } from "./readContract"

describe("readContract", () => {
	it("passes the value through when the call resolves cleanly", async () => {
		const read = await readContract(() => Promise.resolve({ result: 42n }))

		expect(read).toEqual({ kind: "value", value: 42n })
	})

	it("parses the error code out of the simulation, never touching result", async () => {
		const read = await readContract(() =>
			Promise.resolve({
				simulation: { error: "HostError: Error(Contract, #3006)" },
				get result(): bigint {
					throw new Error("No simulation result!")
				},
			}),
		)

		expect(read).toEqual({ kind: "contract-error", code: 3006 })
	})

	it("is unreadable when the call itself rejects", async () => {
		const read = await readContract(() =>
			Promise.reject(new Error("network down")),
		)

		expect(read).toEqual({ kind: "unreadable" })
	})

	it("is unreadable when result throws and no simulation error matches", async () => {
		const read = await readContract(() =>
			Promise.resolve({
				get result(): bigint {
					throw new Error("restore preamble required")
				},
			}),
		)

		expect(read).toEqual({ kind: "unreadable" })
	})
})

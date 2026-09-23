import type { Api } from "@stellar/stellar-sdk/rpc"
import { describe, expect, it } from "vitest"
import { readContract } from "./readContract"

const errorSimulation: Api.SimulateTransactionErrorResponse = {
	id: "1",
	latestLedger: 100,
	events: [],
	_parsed: true,
	error: "HostError: Error(Contract, #3006)",
}

describe("readContract", () => {
	it("passes the value through when the call resolves cleanly", async () => {
		const read = await readContract(() => Promise.resolve({ result: 42n }))

		expect(read).toEqual({ kind: "value", value: 42n })
	})

	it("parses the error code out of the simulation, never touching result", async () => {
		const read = await readContract(() =>
			Promise.resolve({
				simulation: errorSimulation,
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

	it("is archived when the simulation carries a restore preamble, never touching result", async () => {
		const restoreSimulation = {
			id: "1",
			latestLedger: 100,
			events: [],
			_parsed: true,
			transactionData: {},
			minResourceFee: "100",
			result: { auth: [], retval: {} },
			restorePreamble: { minResourceFee: "100", transactionData: {} },
		} as unknown as Api.SimulateTransactionResponse

		const read = await readContract(() =>
			Promise.resolve({
				simulation: restoreSimulation,
				get result(): bigint {
					throw new Error("You need to restore some contract state first")
				},
			}),
		)

		expect(read).toEqual({ kind: "archived" })
	})
})

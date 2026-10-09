import { nativeToScVal, xdr } from "@stellar/stellar-sdk"
import type { Api } from "@stellar/stellar-sdk/rpc"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DepositRequest, EpochInfo, RedeemRequest } from "./contracts"
import {
	readContract,
	readEpochRequests,
	readEpochs,
	readEvents,
	readLedgerTime,
} from "./readContract"

const {
	getLedgerEntriesMock,
	getLatestLedgerMock,
	getHealthMock,
	getEventsMock,
} = vi.hoisted(() => ({
	getLedgerEntriesMock: vi.fn(),
	getLatestLedgerMock: vi.fn(),
	getHealthMock: vi.fn(),
	getEventsMock: vi.fn(),
}))

vi.mock("@stellar/stellar-sdk/rpc", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@stellar/stellar-sdk/rpc")>()
	class MockServer {
		getLedgerEntries = getLedgerEntriesMock
		getLatestLedger = getLatestLedgerMock
		getHealth = getHealthMock
		getEvents = getEventsMock
	}
	return { ...actual, Server: MockServer }
})

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
			transactionData: {},
			restorePreamble: { transactionData: {} },
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

const CONTRACT_ID = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR"
const CONTROLLER = "GDPO5SQDJY4E2XEE47MAOT2M2F3GR4H2AYYKSMIOT2YPOHAMC36VKWIA"

const EPOCH_5_KEY_XDR =
	"AAAABgAAAAEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwAAABAAAAABAAAAAgAAAA8AAAAFRXBvY2gAAAAAAAAFAAAAAAAAAAUAAAAB"
const DEPOSIT_5_KEY_XDR =
	"AAAABgAAAAEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwAAABAAAAABAAAAAwAAAA8AAAALVXNlckRlcG9zaXQAAAAABQAAAAAAAAAFAAAAEgAAAAAAAAAA3u7KA044TVyE59gHT0zRdmjw+gYwqTEOnrD3HAwW/VUAAAAB"
const REDEEM_5_KEY_XDR =
	"AAAABgAAAAEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwAAABAAAAABAAAAAwAAAA8AAAAKVXNlclJlZGVlbQAAAAAABQAAAAAAAAAFAAAAEgAAAAAAAAAA3u7KA044TVyE59gHT0zRdmjw+gYwqTEOnrD3HAwW/VUAAAAB"

const structScVal = (fields: Record<string, xdr.ScVal>): xdr.ScVal =>
	xdr.ScVal.scvMap(
		Object.entries(fields)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(
				([key, val]) =>
					new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
			),
	)

const scvU64 = (value: bigint) =>
	xdr.ScVal.scvU64(xdr.Uint64.fromString(value.toString()))
const scvI128 = (value: bigint) => nativeToScVal(value, { type: "i128" })
const enumScVal = (tag: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tag)])

const openEpoch: EpochInfo = {
	status: { tag: "Open", values: undefined },
	total_deposited: 100_0000000n,
	total_shares_redeeming: 0n,
	share_price: 0n,
	closed_at: 0n,
	priceable_at: 0n,
}
const openEpochScVal = structScVal({
	status: enumScVal("Open"),
	total_deposited: scvI128(openEpoch.total_deposited),
	total_shares_redeeming: scvI128(openEpoch.total_shares_redeeming),
	share_price: scvI128(openEpoch.share_price),
	closed_at: scvU64(openEpoch.closed_at),
	priceable_at: scvU64(openEpoch.priceable_at),
})

const depositRequest: DepositRequest = { amount: 100_0000000n, claimed: false }
const depositScVal = structScVal({
	amount: scvI128(depositRequest.amount),
	claimed: xdr.ScVal.scvBool(depositRequest.claimed),
})

const redeemRequest: RedeemRequest = { shares: 20_0000000n, claimed: false }
const redeemScVal = structScVal({
	shares: scvI128(redeemRequest.shares),
	claimed: xdr.ScVal.scvBool(redeemRequest.claimed),
})

function entryFor(
	keyXdr: string,
	value: xdr.ScVal,
	liveUntilLedgerSeq: number,
): Api.LedgerEntryResult {
	const key = xdr.LedgerKey.fromXDR(keyXdr, "base64")
	const contractData = key.contractData()
	return {
		key,
		val: xdr.LedgerEntryData.contractData(
			new xdr.ContractDataEntry({
				ext: new xdr.ExtensionPoint(0),
				contract: contractData.contract(),
				key: contractData.key(),
				durability: contractData.durability(),
				val: value,
			}),
		),
		liveUntilLedgerSeq,
	}
}

describe("readEpochRequests", () => {
	beforeEach(() => {
		getLedgerEntriesMock.mockReset()
		getLatestLedgerMock.mockReset()
	})

	it("returns an empty map and makes no RPC calls for an empty epoch list", async () => {
		const result = await readEpochRequests(CONTRACT_ID, CONTROLLER, [])

		expect(result.size).toBe(0)
		expect(getLedgerEntriesMock).not.toHaveBeenCalled()
		expect(getLatestLedgerMock).not.toHaveBeenCalled()
	})

	it("builds the Epoch, UserDeposit and UserRedeem keys from the documented DataKey encoding", async () => {
		getLedgerEntriesMock.mockResolvedValue({ entries: [], latestLedger: 100 })
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		await readEpochRequests(CONTRACT_ID, CONTROLLER, [5n])

		const sentKeys = getLedgerEntriesMock.mock.calls[0] as xdr.LedgerKey[]
		expect(sentKeys.map((key) => key.toXDR("base64"))).toEqual([
			EPOCH_5_KEY_XDR,
			DEPOSIT_5_KEY_XDR,
			REDEEM_5_KEY_XDR,
		])
	})

	it("chunks 67 epochs into two getLedgerEntries requests, 66 epochs then 1", async () => {
		getLedgerEntriesMock.mockResolvedValue({ entries: [], latestLedger: 100 })
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const epochIds = Array.from({ length: 67 }, (_, i) => BigInt(i + 1))
		await readEpochRequests(CONTRACT_ID, CONTROLLER, epochIds)

		expect(getLedgerEntriesMock).toHaveBeenCalledTimes(2)
		expect(getLedgerEntriesMock.mock.calls[0]).toHaveLength(66 * 3)
		expect(getLedgerEntriesMock.mock.calls[1]).toHaveLength(1 * 3)
	})

	it("decodes a fully present epoch to the same shape the simulate path returns", async () => {
		getLedgerEntriesMock.mockResolvedValue({
			entries: [
				entryFor(EPOCH_5_KEY_XDR, openEpochScVal, 1000),
				entryFor(DEPOSIT_5_KEY_XDR, depositScVal, 1000),
				entryFor(REDEEM_5_KEY_XDR, redeemScVal, 1000),
			],
			latestLedger: 100,
		})
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const result = await readEpochRequests(CONTRACT_ID, CONTROLLER, [5n])

		expect(result.get(5n)).toEqual({
			epoch: { kind: "value", value: openEpoch },
			deposit: { kind: "value", value: depositRequest },
			redeem: { kind: "value", value: redeemRequest },
		})
	})

	it("maps a key missing from the response to a genuine absence, not a failure", async () => {
		getLedgerEntriesMock.mockResolvedValue({
			entries: [entryFor(EPOCH_5_KEY_XDR, openEpochScVal, 1000)],
			latestLedger: 100,
		})
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const result = await readEpochRequests(CONTRACT_ID, CONTROLLER, [5n])

		expect(result.get(5n)).toEqual({
			epoch: { kind: "value", value: openEpoch },
			deposit: { kind: "value", value: null },
			redeem: { kind: "value", value: null },
		})
	})

	it("maps an entry whose TTL has lapsed to archived, never as a decoded value", async () => {
		getLedgerEntriesMock.mockResolvedValue({
			entries: [entryFor(EPOCH_5_KEY_XDR, openEpochScVal, 50)],
			latestLedger: 100,
		})
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const result = await readEpochRequests(CONTRACT_ID, CONTROLLER, [5n])

		expect(result.get(5n)?.epoch).toEqual({ kind: "archived" })
	})

	it("marks a value unreadable when the stored ScVal does not match the expected struct shape", async () => {
		getLedgerEntriesMock.mockResolvedValue({
			entries: [entryFor(EPOCH_5_KEY_XDR, xdr.ScVal.scvBool(true), 1000)],
			latestLedger: 100,
		})
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const result = await readEpochRequests(CONTRACT_ID, CONTROLLER, [5n])

		expect(result.get(5n)?.epoch).toEqual({ kind: "unreadable" })
	})

	it("marks only the failed chunk's keys unreadable, leaving the other chunk unaffected", async () => {
		getLedgerEntriesMock
			.mockRejectedValueOnce(new Error("network down"))
			.mockResolvedValueOnce({ entries: [], latestLedger: 100 })
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const epochIds = Array.from({ length: 67 }, (_, i) => BigInt(i + 1))
		const result = await readEpochRequests(CONTRACT_ID, CONTROLLER, epochIds)

		expect(result.get(1n)).toEqual({
			epoch: { kind: "unreadable" },
			deposit: { kind: "unreadable" },
			redeem: { kind: "unreadable" },
		})
		expect(result.get(67n)).toEqual({
			epoch: { kind: "value", value: null },
			deposit: { kind: "value", value: null },
			redeem: { kind: "value", value: null },
		})
	})

	it("treats a present entry as unreadable, not value, when the current ledger sequence is unknown", async () => {
		getLedgerEntriesMock.mockResolvedValue({
			entries: [entryFor(EPOCH_5_KEY_XDR, openEpochScVal, 1000)],
			latestLedger: 100,
		})
		getLatestLedgerMock.mockRejectedValue(new Error("network down"))

		const result = await readEpochRequests(CONTRACT_ID, CONTROLLER, [5n])

		expect(result.get(5n)).toEqual({
			epoch: { kind: "unreadable" },
			deposit: { kind: "value", value: null },
			redeem: { kind: "value", value: null },
		})
	})
})

describe("readEpochs", () => {
	beforeEach(() => {
		getLedgerEntriesMock.mockReset()
		getLatestLedgerMock.mockReset()
	})

	it("returns an empty map and makes no RPC calls for an empty epoch list", async () => {
		const result = await readEpochs(CONTRACT_ID, [])

		expect(result.size).toBe(0)
		expect(getLedgerEntriesMock).not.toHaveBeenCalled()
	})

	it("sends only the Epoch key, with no request keys", async () => {
		getLedgerEntriesMock.mockResolvedValue({ entries: [], latestLedger: 100 })
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		await readEpochs(CONTRACT_ID, [5n])

		const sentKeys = getLedgerEntriesMock.mock.calls[0] as xdr.LedgerKey[]
		expect(sentKeys.map((key) => key.toXDR("base64"))).toEqual([
			EPOCH_5_KEY_XDR,
		])
	})

	it("decodes a present epoch and reports a missing key as a genuine absence", async () => {
		getLedgerEntriesMock.mockResolvedValue({
			entries: [entryFor(EPOCH_5_KEY_XDR, openEpochScVal, 1000)],
			latestLedger: 100,
		})
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const result = await readEpochs(CONTRACT_ID, [5n, 6n])

		expect(result.get(5n)).toEqual({ kind: "value", value: openEpoch })
		expect(result.get(6n)).toEqual({ kind: "value", value: null })
	})

	it("reports an entry whose TTL has lapsed as archived", async () => {
		getLedgerEntriesMock.mockResolvedValue({
			entries: [entryFor(EPOCH_5_KEY_XDR, openEpochScVal, 50)],
			latestLedger: 100,
		})
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const result = await readEpochs(CONTRACT_ID, [5n])

		expect(result.get(5n)).toEqual({ kind: "archived" })
	})

	it("packs 201 epochs into two requests of 200 and 1", async () => {
		getLedgerEntriesMock.mockResolvedValue({ entries: [], latestLedger: 100 })
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const epochIds = Array.from({ length: 201 }, (_, i) => BigInt(i + 1))
		await readEpochs(CONTRACT_ID, epochIds)

		expect(getLedgerEntriesMock).toHaveBeenCalledTimes(2)
		expect(getLedgerEntriesMock.mock.calls[0]).toHaveLength(200)
		expect(getLedgerEntriesMock.mock.calls[1]).toHaveLength(1)
	})

	it("marks only the failed chunk's epochs unreadable", async () => {
		getLedgerEntriesMock
			.mockRejectedValueOnce(new Error("network down"))
			.mockResolvedValueOnce({ entries: [], latestLedger: 100 })
		getLatestLedgerMock.mockResolvedValue({ sequence: 100 })

		const epochIds = Array.from({ length: 201 }, (_, i) => BigInt(i + 1))
		const result = await readEpochs(CONTRACT_ID, epochIds)

		expect(result.get(1n)).toEqual({ kind: "unreadable" })
		expect(result.get(201n)).toEqual({ kind: "value", value: null })
	})
})

describe("readLedgerTime", () => {
	beforeEach(() => {
		getLatestLedgerMock.mockReset()
	})

	it("returns the close time of the latest ledger in seconds", async () => {
		getLatestLedgerMock.mockResolvedValue({
			sequence: 100,
			closeTime: "1700000000",
		})

		expect(await readLedgerTime()).toBe(1_700_000_000n)
	})

	it("is null when the RPC cannot be reached", async () => {
		getLatestLedgerMock.mockRejectedValue(new Error("network down"))

		expect(await readLedgerTime()).toBeNull()
	})
})

const symbolTopic = (name: string): xdr.ScVal => xdr.ScVal.scvSymbol(name)

const eventResponse = (overrides: {
	name: string
	second: xdr.ScVal
	data: xdr.ScVal
	ledger: number
	closedAt: string
	contractId?: string
}) => ({
	id: `${overrides.ledger}-1`,
	type: "contract",
	ledger: overrides.ledger,
	ledgerClosedAt: overrides.closedAt,
	contractId: { contractId: () => overrides.contractId ?? CONTRACT_ID },
	topic: [symbolTopic(overrides.name), overrides.second],
	value: overrides.data,
})

const SEVEN_DAYS_OF_LEDGERS = 120_960

describe("readEvents", () => {
	beforeEach(() => {
		getHealthMock.mockReset()
		getEventsMock.mockReset()
	})

	it("starts at the window's first ledger and filters by contract and topic name", async () => {
		getHealthMock.mockResolvedValue({
			latestLedger: 500_000,
			oldestLedger: 1,
		})
		getEventsMock.mockResolvedValue({ events: [], cursor: "c" })

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed", "epoch_fulfilled"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(read).toEqual({ kind: "value", value: [], partial: false })
		const [request] = getEventsMock.mock.calls[0] as [
			{ startLedger: number; filters: unknown[] },
		]
		expect(request.startLedger).toBe(500_000 - SEVEN_DAYS_OF_LEDGERS)
		expect(request.filters).toEqual([
			{
				type: "contract",
				contractIds: [CONTRACT_ID],
				topics: [
					[symbolTopic("epoch_closed").toXDR("base64"), "*"],
					[symbolTopic("epoch_fulfilled").toXDR("base64"), "*"],
				],
			},
		])
	})

	it("never starts before the oldest ledger the RPC still holds", async () => {
		getHealthMock.mockResolvedValue({
			latestLedger: 500_000,
			oldestLedger: 480_000,
		})
		getEventsMock.mockResolvedValue({ events: [], cursor: "c" })

		await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		const [request] = getEventsMock.mock.calls[0] as [{ startLedger: number }]
		expect(request.startLedger).toBe(480_000)
	})

	it("decodes the name, topics, data, ledger and close time of each event", async () => {
		getHealthMock.mockResolvedValue({ latestLedger: 500_000, oldestLedger: 1 })
		getEventsMock.mockResolvedValue({
			events: [
				eventResponse({
					name: "epoch_closed",
					second: scvU64(3n),
					data: structScVal({
						total_deposited: scvI128(400n),
						total_shares_redeeming: scvI128(0n),
					}),
					ledger: 499_000,
					closedAt: "2026-10-07T12:00:00Z",
				}),
			],
			cursor: "c",
		})

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(read).toEqual({
			kind: "value",
			partial: false,
			value: [
				{
					contractId: CONTRACT_ID,
					name: "epoch_closed",
					topics: [3n],
					data: { total_deposited: 400n, total_shares_redeeming: 0n },
					ledger: 499_000,
					closedAt: 1_791_374_400n,
				},
			],
		})
	})

	it("follows the cursor until a page comes back short", async () => {
		getHealthMock.mockResolvedValue({ latestLedger: 500_000, oldestLedger: 1 })
		const event = eventResponse({
			name: "epoch_closed",
			second: scvU64(1n),
			data: structScVal({}),
			ledger: 499_000,
			closedAt: "2026-10-07T12:00:00Z",
		})
		getEventsMock
			.mockResolvedValueOnce({
				events: Array.from({ length: 200 }, () => event),
				cursor: "next",
			})
			.mockResolvedValueOnce({ events: [event], cursor: "end" })

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(read.kind === "value" && read.value).toHaveLength(201)
		expect(getEventsMock).toHaveBeenCalledTimes(2)
		const [second] = getEventsMock.mock.calls[1] as [
			{ cursor: string; startLedger?: number },
		]
		expect(second.cursor).toBe("next")
		expect(second.startLedger).toBeUndefined()
	})

	it("returns what it gathered, flagged partial, when the page cap is hit", async () => {
		getHealthMock.mockResolvedValue({ latestLedger: 500_000, oldestLedger: 1 })
		const event = eventResponse({
			name: "epoch_closed",
			second: scvU64(1n),
			data: structScVal({}),
			ledger: 499_000,
			closedAt: "2026-10-07T12:00:00Z",
		})
		getEventsMock.mockResolvedValue({
			events: Array.from({ length: 200 }, () => event),
			cursor: "next",
		})

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(getEventsMock).toHaveBeenCalledTimes(25)
		expect(read.kind === "value" && read.partial).toBe(true)
		expect(read.kind === "value" && read.value).toHaveLength(5_000)
	})

	it("skips an event it cannot decode instead of failing the read", async () => {
		getHealthMock.mockResolvedValue({ latestLedger: 500_000, oldestLedger: 1 })
		const good = eventResponse({
			name: "epoch_closed",
			second: scvU64(1n),
			data: structScVal({}),
			ledger: 499_000,
			closedAt: "2026-10-07T12:00:00Z",
		})
		const bad = { ...good, ledgerClosedAt: "not a date" }
		getEventsMock.mockResolvedValue({ events: [bad, good], cursor: "c" })

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(read.kind === "value" && read.value).toHaveLength(1)
		expect(read.kind === "value" && read.partial).toBe(false)
	})

	it("stays unreadable when a later page fails", async () => {
		getHealthMock.mockResolvedValue({ latestLedger: 500_000, oldestLedger: 1 })
		const event = eventResponse({
			name: "epoch_closed",
			second: scvU64(1n),
			data: structScVal({}),
			ledger: 499_000,
			closedAt: "2026-10-07T12:00:00Z",
		})
		getEventsMock
			.mockResolvedValueOnce({
				events: Array.from({ length: 200 }, () => event),
				cursor: "next",
			})
			.mockRejectedValueOnce(new Error("network down"))

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(read).toEqual({ kind: "unreadable" })
	})

	it("is unreadable when the RPC cannot serve the window", async () => {
		getHealthMock.mockResolvedValue({ latestLedger: 500_000, oldestLedger: 1 })
		getEventsMock.mockRejectedValue(new Error("startLedger out of range"))

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(read).toEqual({ kind: "unreadable" })
	})

	it("is unreadable when the RPC health cannot be read", async () => {
		getHealthMock.mockRejectedValue(new Error("network down"))

		const read = await readEvents(
			[{ contractId: CONTRACT_ID, names: ["epoch_closed"] }],
			SEVEN_DAYS_OF_LEDGERS,
		)

		expect(read).toEqual({ kind: "unreadable" })
	})
})

import { Keypair } from "@stellar/stellar-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { price } from "./amounts.js"
import { type Connected } from "./clients.js"

const { oracleMock, sendMock } = vi.hoisted(() => ({
	oracleMock: vi.fn(),
	sendMock: vi.fn(),
}))

vi.mock("./clients.js", () => ({
	oracle: oracleMock,
	send: sendMock,
}))

const { climbHookTimeoutMs, freshFeed, moveNavTo } = await import("./oracle.js")
const { networkNamed } = await import("./network.js")

interface FakeTx {
	result: unknown
	simulation?: { error: string }
}

const NO_RECORD_CODE = 3006

const accepted = (result: unknown): FakeTx => ({ result })

const noRecord = (): FakeTx => ({
	result: undefined,
	simulation: { error: `HostError: Error(Contract, #${NO_RECORD_CODE})` },
})

function fakeOracle(stateTag: "Stale" | "Valid", latest: FakeTx) {
	const attestedNavs: bigint[] = []
	const client = {
		state: () => Promise.resolve({ result: { tag: stateTag } }),
		latest: () => Promise.resolve(latest),
		attest: (args: { input: { nav_per_share: bigint } }) => {
			attestedNavs.push(args.input.nav_per_share)
			return Promise.resolve(accepted(undefined))
		},
		spec: {
			errorCases: () => [
				{
					name: () => ({ toString: () => "NoRecord" }),
					value: () => NO_RECORD_CODE,
				},
			],
		},
	}
	return { client, attestedNavs }
}

const connected = (): Connected =>
	({
		keys: { attester: Keypair.random(), outsider: Keypair.random() },
		net: { oracle: { cooldown_secs: 5 } },
	}) as unknown as Connected

function recordLabels(): Array<string | undefined> {
	const labels: Array<string | undefined> = []
	sendMock.mockImplementation(async (tx: Promise<FakeTx>, label?: string) => {
		labels.push(label)
		return (await tx).result
	})
	return labels
}

describe("freshFeed", () => {
	beforeEach(() => {
		oracleMock.mockReset()
		sendMock.mockReset()
	})

	it("attests the stored NAV labeled refresh NAV when stale with a report", async () => {
		const { client, attestedNavs } = fakeOracle(
			"Stale",
			accepted({ nav_per_share: 42n }),
		)
		oracleMock.mockReturnValue(client)
		const labels = recordLabels()

		await freshFeed(connected(), 7n)

		expect(labels).toEqual(["refresh NAV"])
		expect(attestedNavs).toEqual([42n])
	})

	it("attests the fallback labeled refresh NAV when stale with no record", async () => {
		const { client, attestedNavs } = fakeOracle("Stale", noRecord())
		oracleMock.mockReturnValue(client)
		const labels = recordLabels()

		await freshFeed(connected(), 7n)

		expect(labels).toEqual(["refresh NAV"])
		expect(attestedNavs).toEqual([7n])
	})

	it("sends nothing when the oracle is valid", async () => {
		const { client, attestedNavs } = fakeOracle("Valid", accepted(undefined))
		oracleMock.mockReturnValue(client)

		await freshFeed(connected(), 7n)

		expect(sendMock).not.toHaveBeenCalled()
		expect(attestedNavs).toEqual([])
	})
})

const DEVIATION_EXCEEDED_CODE = 3004
const MAX_UP_BPS = 1000

// Holds the last report and refuses a rise past the cap, as the contract does.
function cappedOracle(stored: bigint | undefined) {
	let last = stored
	const attestedNavs: bigint[] = []
	const client = {
		config: () => Promise.resolve({ result: { max_up_bps: MAX_UP_BPS } }),
		latest: () =>
			Promise.resolve(
				last === undefined ? noRecord() : accepted({ nav_per_share: last }),
			),
		attest: (args: { input: { nav_per_share: bigint } }) => {
			const nav = args.input.nav_per_share
			if (
				last !== undefined &&
				nav - last > (last * BigInt(MAX_UP_BPS)) / 10_000n
			) {
				return Promise.resolve({
					result: undefined,
					simulation: {
						error: `HostError: Error(Contract, #${DEVIATION_EXCEEDED_CODE})`,
					},
				})
			}
			last = nav
			attestedNavs.push(nav)
			return Promise.resolve(accepted(undefined))
		},
		spec: {
			errorCases: () => [
				{
					name: () => ({ toString: () => "NoRecord" }),
					value: () => NO_RECORD_CODE,
				},
				{
					name: () => ({ toString: () => "DeviationExceeded" }),
					value: () => DEVIATION_EXCEEDED_CODE,
				},
			],
		},
	}
	return { client, attestedNavs }
}

describe("moveNavTo", () => {
	beforeEach(() => {
		oracleMock.mockReset()
		sendMock.mockReset()
		recordLabels()
	})

	it("attests the target when no report is stored", async () => {
		const { client, attestedNavs } = cappedOracle(undefined)
		oracleMock.mockReturnValue(client)

		await moveNavTo(connected(), 200n)

		expect(attestedNavs).toEqual([200n])
	})

	it("attests a fall of any size at once", async () => {
		const { client, attestedNavs } = cappedOracle(1_000n)
		oracleMock.mockReturnValue(client)

		await moveNavTo(connected(), 200n)

		expect(attestedNavs).toEqual([200n])
	})

	it("attests a rise within the cap at once", async () => {
		const { client, attestedNavs } = cappedOracle(190n)
		oracleMock.mockReturnValue(client)

		await moveNavTo(connected(), 200n)

		expect(attestedNavs).toEqual([200n])
	})

	it("climbs to a target past the cap one capped rise at a time", async () => {
		const { client, attestedNavs } = cappedOracle(100n)
		oracleMock.mockReturnValue(client)

		await moveNavTo(connected(), 200n)

		expect(attestedNavs).toEqual([
			110n,
			121n,
			133n,
			146n,
			160n,
			176n,
			193n,
			200n,
		])
	})
})

describe("climbHookTimeoutMs", () => {
	it("gives a testnet climb from the band's floor to 2.00 sixteen cooldowns past the usual five minutes", () => {
		const testnet = networkNamed("testnet")

		expect(climbHookTimeoutMs(testnet, price(2))).toBe(300_000 + 16 * 120_000)
	})

	it("adds one report when the target is at or under the floor", () => {
		const local = networkNamed("local")

		expect(climbHookTimeoutMs(local, BigInt(local.oracle.min_answer))).toBe(
			300_000 + 65_000,
		)
	})
})

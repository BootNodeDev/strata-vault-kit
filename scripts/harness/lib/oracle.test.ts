import { Keypair } from "@stellar/stellar-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type Connected } from "./clients.js"

const { oracleMock, sendMock } = vi.hoisted(() => ({
	oracleMock: vi.fn(),
	sendMock: vi.fn(),
}))

vi.mock("./clients.js", () => ({
	oracle: oracleMock,
	send: sendMock,
}))

const { freshFeed } = await import("./oracle.js")

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

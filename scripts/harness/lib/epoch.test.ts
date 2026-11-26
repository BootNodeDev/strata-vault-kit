import { Keypair } from "@stellar/stellar-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type Connected } from "./clients.js"

const { attestMock, oracleMock, sendMock, vaultMock, waitForNoticeMock } =
	vi.hoisted(() => ({
		attestMock: vi.fn(),
		oracleMock: vi.fn(),
		sendMock: vi.fn(),
		vaultMock: vi.fn(),
		waitForNoticeMock: vi.fn(),
	}))

vi.mock("./clients.js", () => ({
	oracle: oracleMock,
	send: sendMock,
	vault: vaultMock,
}))
vi.mock("./notice.js", () => ({ waitForNotice: waitForNoticeMock }))
vi.mock("./oracle.js", () => ({ attest: attestMock }))

const { priceOpenEpoch } = await import("./epoch.js")

interface OpenEpoch {
	total_deposited: bigint
	total_shares_redeeming: bigint
}

const STANDING_NAV = 42n

const connected = (): Connected =>
	({
		keys: { manager: Keypair.random(), outsider: Keypair.random() },
	}) as unknown as Connected

function fakeVault(open: OpenEpoch | null) {
	return {
		current_epoch: () => Promise.resolve({ result: 2n }),
		get_epoch: () => Promise.resolve({ result: open }),
		close_epoch: () => Promise.resolve({ result: 2n, call: "close_epoch" }),
		fulfill_epoch: () =>
			Promise.resolve({ result: STANDING_NAV, call: "fulfill_epoch" }),
	}
}

function recordSteps(): string[] {
	const steps: string[] = []
	sendMock.mockImplementation(async (tx: Promise<{ call: string }>) => {
		steps.push((await tx).call)
	})
	attestMock.mockImplementation((_c: Connected, nav: bigint) => {
		steps.push(`attest ${nav}`)
		return Promise.resolve()
	})
	waitForNoticeMock.mockImplementation(() => {
		steps.push("wait for notice")
		return Promise.resolve()
	})
	return steps
}

describe("priceOpenEpoch", () => {
	beforeEach(() => {
		vi.resetAllMocks()
		oracleMock.mockReturnValue({
			latest: () =>
				Promise.resolve({ result: { nav_per_share: STANDING_NAV } }),
		})
	})

	it.each([
		["holds no record", null],
		["holds no request", { total_deposited: 0n, total_shares_redeeming: 0n }],
	])("leaves the open epoch alone when it %s", async (_, open) => {
		vaultMock.mockReturnValue(fakeVault(open))
		const steps = recordSteps()

		await priceOpenEpoch(connected())

		expect(steps).toEqual([])
	})

	it.each([
		["a deposit", { total_deposited: 5n, total_shares_redeeming: 0n }],
		["a redemption", { total_deposited: 0n, total_shares_redeeming: 5n }],
	])(
		"seals an epoch holding %s and prices it at the standing NAV",
		async (_, open) => {
			vaultMock.mockReturnValue(fakeVault(open))
			const steps = recordSteps()

			await priceOpenEpoch(connected())

			expect(steps).toEqual([
				"close_epoch",
				`attest ${STANDING_NAV}`,
				"wait for notice",
				"fulfill_epoch",
			])
		},
	)
})

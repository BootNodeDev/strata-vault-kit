import {
	type Amount,
	type EpochStatus,
	type Price,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import {
	type ArchivedRequest,
	type InvestorRequest,
	type UnreadableRequest,
} from "../hooks/useInvestorRequests"
import { assignStage, toRequestEntriesByStage } from "./vaultRequests"

const amount = (value: bigint): Amount => value as Amount
const price = (value: bigint): Price => value as Price

const open: EpochStatus = { tag: "Open", values: undefined }
const pending: EpochStatus = { tag: "Pending", values: undefined }
const fulfilled: EpochStatus = { tag: "Fulfilled", values: undefined }

const tokens = { token: "USDC", shareToken: "vUSDC" }

const deposit: InvestorRequest = {
	epochId: 1n,
	side: "deposit",
	epochStatus: fulfilled,
	sharePrice: price(2_000_000_000_000_000_000n),
	amount: amount(100_0000000n),
	claimed: false,
}

const redeem: InvestorRequest = {
	epochId: 2n,
	side: "redeem",
	epochStatus: fulfilled,
	sharePrice: price(2_000_000_000_000_000_000n),
	amount: amount(100_0000000n),
	claimed: false,
}

describe("assignStage", () => {
	it.each([
		["Open", open],
		["Pending", pending],
	])("puts an unpriced %s epoch in waiting", (_label, epochStatus) => {
		expect(assignStage({ ...deposit, epochStatus }, undefined)).toBe("waiting")
	})

	it("puts a priced, unrefused request in ready", () => {
		expect(assignStage(deposit, undefined)).toBe("ready")
	})

	it("puts a priced, refused request in blocked", () => {
		expect(assignStage(deposit, { reason: "The vault is paused." })).toBe(
			"blocked",
		)
	})

	it("puts an unpriced epoch in waiting even when a refusal is also present", () => {
		const unpriced = { ...deposit, epochStatus: open }
		expect(assignStage(unpriced, { reason: "The vault is paused." })).toBe(
			"waiting",
		)
	})

	it("puts a fulfilled epoch with an invalid price in blocked", () => {
		const brokenPrice = { ...deposit, sharePrice: price(0n) }
		expect(assignStage(brokenPrice, undefined)).toBe("blocked")
	})
})

describe("toRequestEntriesByStage", () => {
	it("returns an empty result for no requests", () => {
		expect(
			toRequestEntriesByStage(
				{ requests: [], archived: [], unreadable: [] },
				tokens,
			),
		).toEqual({ ready: [], blocked: [], waiting: [] })
	})

	it("drops a claimed request entirely", () => {
		const result = toRequestEntriesByStage(
			{
				requests: [{ ...deposit, claimed: true }],
				archived: [],
				unreadable: [],
			},
			tokens,
		)
		expect(result).toEqual({ ready: [], blocked: [], waiting: [] })
	})

	it("puts an unpriced deposit in waiting, with no promised value", () => {
		const waiting: InvestorRequest = { ...deposit, epochStatus: open }
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.waiting).toEqual([
			{
				id: "deposit-1",
				inLabel: "Subscription",
				inAmount: "100.00 USDC",
				inMeta: "Batch 1",
				outLabel: "Owed to you",
				outAmount: "Not yet priced",
				outTone: "word",
				state: "Open",
				tone: "pending",
				actions: [],
			},
		])
	})

	it("prices a ready deposit's owed shares and notes claiming is not guaranteed", () => {
		const result = toRequestEntriesByStage(
			{ requests: [deposit], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.ready).toEqual([
			{
				id: "deposit-1",
				inLabel: "Subscription",
				inAmount: "100.00 USDC",
				inMeta: "Batch 1",
				outLabel: "Owed to you",
				outAmount: "50.00 vUSDC",
				outTone: "ok",
				state: "Priced",
				tone: "claimable",
				actions: [],
				note: "Claiming is not guaranteed to succeed. Compliance is checked when you sign.",
			},
		])
	})

	it("prices a ready redeem's owed cash and notes claiming is not guaranteed", () => {
		const result = toRequestEntriesByStage(
			{ requests: [redeem], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.ready).toEqual([
			{
				id: "redeem-2",
				inLabel: "Redemption",
				inAmount: "100.00 vUSDC",
				inMeta: "Batch 2",
				outLabel: "Owed to you",
				outAmount: "200.00 USDC",
				outTone: "ok",
				state: "Priced",
				tone: "claimable",
				actions: [],
				note: "Claiming is not guaranteed to succeed. The reserve is checked when you sign.",
			},
		])
	})

	it("carries the vault's own refusal reason into blocked, never a guess", () => {
		const result = toRequestEntriesByStage(
			{ requests: [redeem], archived: [], unreadable: [] },
			tokens,
			() => ({ reason: "This address is not on the vault's allowlist." }),
		)

		expect(result.blocked).toEqual([
			{
				id: "redeem-2",
				inLabel: "Redemption",
				inAmount: "100.00 vUSDC",
				inMeta: "Batch 2",
				outLabel: "Owed to you",
				outAmount: "200.00 USDC",
				outTone: "stop",
				state: "Blocked",
				tone: "blocked",
				actions: [],
				tooltip: {
					label: "Why you cannot claim this yet",
					text: "This address is not on the vault's allowlist.",
				},
			},
		])
	})

	it("places an archived request in blocked, distinguishable from a refusal", () => {
		const archived: ArchivedRequest = {
			epochId: 3n,
			side: "deposit",
			epochStatus: fulfilled,
			sharePrice: price(2_000_000_000_000_000_000n),
		}
		const result = toRequestEntriesByStage(
			{ requests: [], archived: [archived], unreadable: [] },
			tokens,
		)

		expect(result.blocked).toEqual([
			{
				id: "deposit-3",
				inLabel: "Subscription",
				inAmount: "Unknown amount",
				inMeta: "Batch 3",
				outLabel: "Owed to you",
				outAmount: "Not readable",
				outTone: "word",
				state: "Expired",
				tone: "blocked",
				actions: [],
				tooltip: {
					label: "Why you cannot claim this yet",
					text: "This request's record expired from storage and can no longer be read on chain.",
				},
			},
		])
	})

	it("floors the owed amount rather than rounding it", () => {
		const uneven: InvestorRequest = {
			...deposit,
			amount: amount(10000199999n),
			sharePrice: price(2_100000000000000000n),
		}
		const result = toRequestEntriesByStage(
			{ requests: [uneven], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.ready[0]?.outAmount).toBe("476.19 vUSDC")
	})

	it("blocks a fulfilled request with an invalid price instead of throwing", () => {
		const brokenPrice: InvestorRequest = { ...deposit, sharePrice: price(0n) }
		const result = toRequestEntriesByStage(
			{ requests: [brokenPrice], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.blocked).toEqual([
			{
				id: "deposit-1",
				inLabel: "Subscription",
				inAmount: "100.00 USDC",
				inMeta: "Batch 1",
				outLabel: "Owed to you",
				outAmount: "Not readable",
				outTone: "word",
				state: "Invalid price",
				tone: "blocked",
				actions: [],
				tooltip: {
					label: "Why you cannot claim this yet",
					text: "The vault reported an invalid price for this batch.",
				},
			},
		])
	})

	it("keeps every other entry when one request has an invalid price", () => {
		const brokenPrice: InvestorRequest = { ...redeem, sharePrice: price(0n) }
		const result = toRequestEntriesByStage(
			{ requests: [deposit, brokenPrice], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.ready).toHaveLength(1)
		expect(result.blocked).toHaveLength(1)
	})

	it("offers no cancel action on a waiting deposit when no handler is given", () => {
		const waiting: InvestorRequest = { ...deposit, epochStatus: open }
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.waiting[0]?.actions).toEqual([])
	})

	it("offers a cancel action on a waiting deposit when a handler is given", () => {
		const waiting: InvestorRequest = { ...deposit, epochStatus: open }
		const onCancel = () => {}
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
			undefined,
			onCancel,
		)

		expect(result.waiting[0]?.actions).toEqual([
			{ label: "Cancel", kind: "ordinary", onPress: expect.any(Function) },
		])
	})

	it("presses the cancel action with the exact request it belongs to", () => {
		const waiting: InvestorRequest = { ...deposit, epochStatus: open }
		const onCancel = vi.fn()
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
			undefined,
			onCancel,
		)

		result.waiting[0]?.actions[0]?.onPress()

		expect(onCancel).toHaveBeenCalledWith(waiting)
	})

	it("offers no cancel action on a waiting redemption, since cancel_deposit is deposit-only", () => {
		const waiting: InvestorRequest = { ...redeem, epochStatus: open }
		const onCancel = () => {}
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
			undefined,
			onCancel,
		)

		expect(result.waiting[0]?.actions).toEqual([])
	})

	it("offers no cancel action once a deposit is priced and no longer waiting", () => {
		const result = toRequestEntriesByStage(
			{ requests: [deposit], archived: [], unreadable: [] },
			tokens,
			undefined,
			() => {},
		)

		expect(result.ready[0]?.actions).toEqual([])
	})

	it("places an unreadable request in blocked, distinguishable from an archived one", () => {
		const unreadable: UnreadableRequest = { epochId: 4n, side: "redeem" }
		const result = toRequestEntriesByStage(
			{ requests: [], archived: [], unreadable: [unreadable] },
			tokens,
		)

		expect(result.blocked).toEqual([
			{
				id: "redeem-4",
				inLabel: "Redemption",
				inAmount: "Unknown amount",
				inMeta: "Batch 4",
				outLabel: "Owed to you",
				outAmount: "Not readable",
				outTone: "word",
				state: "Unreadable",
				tone: "blocked",
				actions: [],
				tooltip: {
					label: "Why you cannot claim this yet",
					text: "Could not read this request from the vault. Try again shortly.",
				},
			},
		])
	})
})

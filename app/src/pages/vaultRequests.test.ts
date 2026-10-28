import {
	type Amount,
	type EpochStatus,
	type Price,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { HELD_WHILE_FROZEN } from "../components/vault/TransactionModal"
import {
	type ArchivedRequest,
	type InvestorRequest,
	type UnreadableRequest,
} from "../hooks/useInvestorRequests"
import { type Allowance } from "../hooks/useIsAllowed"
import { type NavClassification } from "../hooks/useNavPrice"
import { type PauseState } from "../hooks/useVaultPaused"
import {
	assignStage,
	outlookFor,
	type HolderInputs,
	toRequestEntriesByStage,
} from "./vaultRequests"

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
	priceableAt: 1_700_003_600n,
	closedAt: 1_700_000_000n,
}

const redeem: InvestorRequest = {
	epochId: 2n,
	side: "redeem",
	epochStatus: fulfilled,
	sharePrice: price(2_000_000_000_000_000_000n),
	amount: amount(100_0000000n),
	claimed: false,
	priceableAt: 1_700_003_600n,
	closedAt: 1_700_000_000n,
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

	it("puts a priced, held request in blocked", () => {
		expect(
			assignStage(deposit, { held: HELD_WHILE_FROZEN, cancellable: false }),
		).toBe("blocked")
	})

	it("puts an unpriced, held request in blocked rather than waiting", () => {
		const unpriced = { ...deposit, epochStatus: open }
		expect(
			assignStage(unpriced, { held: HELD_WHILE_FROZEN, cancellable: false }),
		).toBe("blocked")
	})

	it("puts a fulfilled epoch with an invalid price in blocked", () => {
		const brokenPrice = { ...deposit, sharePrice: price(0n) }
		expect(assignStage(brokenPrice, undefined)).toBe("blocked")
	})
})

const validNav = (attestedAt: bigint): NavClassification => ({
	status: "valid",
	price: price(1_000_000_000_000_000_000n),
	attestedAt,
})

const holder = (overrides: Partial<HolderInputs> = {}): HolderInputs => ({
	allowance: "allowed",
	frozen: false,
	windingDown: false,
	pause: "open",
	nav: validNav(1_700_000_100n),
	...overrides,
})

describe("outlookFor", () => {
	const sealed: InvestorRequest = { ...deposit, epochStatus: pending }
	const sealedRedeem: InvestorRequest = { ...redeem, epochStatus: pending }

	it("holds every request of a frozen holder with the frozen copy, and offers no cancel", () => {
		for (const request of [deposit, redeem, sealed, sealedRedeem]) {
			expect(outlookFor(holder({ frozen: true }))(request)).toEqual({
				held: HELD_WHILE_FROZEN,
				cancellable: false,
			})
		}
	})

	it("tells a delisted holder that claiming queues the shares as a redemption", () => {
		const outlook = outlookFor(holder({ allowance: "not-allowed" }))(deposit)

		expect(outlook.held).toBeUndefined()
		expect(outlook.claimNote).toMatch(/not allowlisted/)
		expect(outlook.claimNote).toMatch(/queued as a redemption/)
	})

	it("tells a delisted holder in a wind-down that claiming moves the shares into the wind-down claim", () => {
		const outlook = outlookFor(
			holder({ allowance: "not-allowed", windingDown: true }),
		)(deposit)

		expect(outlook.claimNote).toMatch(/wind-down claim/)
	})

	it.each<[string, Allowance]>([
		["allowed", "allowed"],
		["checking", "checking"],
		["unreadable", "unreadable"],
	])(
		"adds no claim note while the allowlist read is %s",
		(_label, allowance) => {
			expect(
				outlookFor(holder({ allowance }))(deposit).claimNote,
			).toBeUndefined()
		},
	)

	it("adds no claim note to a delisted holder's redemption, which pays out as usual", () => {
		expect(
			outlookFor(holder({ allowance: "not-allowed" }))(redeem).claimNote,
		).toBeUndefined()
	})

	it("offers cancel on an open epoch, which has no price to read", () => {
		expect(
			outlookFor(holder())({ ...deposit, epochStatus: open }).cancellable,
		).toBe(true)
	})

	it("hides cancel on a sealed epoch once a price attested after its close is readable", () => {
		expect(outlookFor(holder())(sealed).cancellable).toBe(false)
	})

	it.each<[string, Partial<HolderInputs>]>([
		["the vault is paused", { pause: "paused" as PauseState }],
		["the NAV is paused", { nav: { status: "paused" } }],
		["the feed is stale", { nav: { status: "stale", expiresAt: 1n } }],
		["no price was ever attested", { nav: { status: "never" } }],
		[
			"the price was attested before the close",
			{ nav: validNav(1_699_999_999n) },
		],
		["a wind-down is active", { windingDown: true }],
		["the price cannot be read", { nav: undefined }],
	])("offers cancel on a sealed epoch when %s", (_label, overrides) => {
		expect(outlookFor(holder(overrides))(sealed).cancellable).toBe(true)
	})

	it("hides cancel on a delisted holder's redemption outside a wind-down, since the shares cannot come back", () => {
		const delisted = outlookFor(holder({ allowance: "not-allowed" }))

		expect(delisted({ ...redeem, epochStatus: open }).cancellable).toBe(false)
		expect(delisted({ ...deposit, epochStatus: open }).cancellable).toBe(true)
	})

	it("offers cancel on a delisted holder's redemption in a wind-down, which moves it into the wind-down claim", () => {
		expect(
			outlookFor(holder({ allowance: "not-allowed", windingDown: true }))({
				...redeem,
				epochStatus: open,
			}).cancellable,
		).toBe(true)
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
				outLabel: "Owed to you",
				outAmount: "Not yet priced",
				outTone: "word",
				state: "Open",
				tone: "pending",
				actions: [],
			},
		])
	})

	it("names the floor a closed, unpriced deposit can be priced from", () => {
		const waiting: InvestorRequest = { ...deposit, epochStatus: pending }
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.waiting[0]?.inMeta).toBe("Prices from 14 Nov")
	})

	it("shows no floor for a closed, unpriced deposit with no priceableAt yet", () => {
		const waiting: InvestorRequest = {
			...deposit,
			epochStatus: pending,
			priceableAt: 0n,
		}
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.waiting[0]?.inMeta).toBeUndefined()
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
			{ outlookFor: () => ({ held: HELD_WHILE_FROZEN, cancellable: false }) },
		)

		expect(result.blocked).toEqual([
			{
				id: "redeem-2",
				inLabel: "Redemption",
				inAmount: "100.00 vUSDC",
				outLabel: "Owed to you",
				outAmount: "200.00 USDC",
				outTone: "stop",
				state: "Held",
				tone: "blocked",
				actions: [],
				tooltip: {
					label: "Why this request is held",
					text: HELD_WHILE_FROZEN,
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
				outLabel: "Owed to you",
				outAmount: "Could not read",
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

	it("floors the owed amount, and renders it exactly rather than rounding it for display", () => {
		const uneven: InvestorRequest = {
			...deposit,
			amount: amount(10000199999n),
			sharePrice: price(2_100000000000000000n),
		}
		const result = toRequestEntriesByStage(
			{ requests: [uneven], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.ready[0]?.outAmount).toBe("476.1999999 vUSDC")
	})

	it("renders the requested amount at full precision, not rounded to two fraction digits", () => {
		const uneven: InvestorRequest = { ...deposit, amount: amount(952380952n) }
		const result = toRequestEntriesByStage(
			{ requests: [uneven], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.ready[0]?.inAmount).toBe("95.2380952 USDC")
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
				outLabel: "Owed to you",
				outAmount: "Could not read",
				outTone: "word",
				state: "Invalid price",
				tone: "blocked",
				actions: [],
				tooltip: {
					label: "Why you cannot claim this yet",
					text: "The vault reported an invalid price for this request.",
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
			{ onCancel },
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
			{ onCancel },
		)

		result.waiting[0]?.actions[0]?.onPress()

		expect(onCancel).toHaveBeenCalledWith(waiting)
	})

	it("offers a cancel action on a waiting redemption when a handler is given", () => {
		const waiting: InvestorRequest = { ...redeem, epochStatus: open }
		const onCancel = () => {}
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
			{ onCancel },
		)

		expect(result.waiting[0]?.actions).toEqual([
			{ label: "Cancel", kind: "ordinary", onPress: expect.any(Function) },
		])
	})

	it("presses the cancel action with the exact redemption request it belongs to", () => {
		const waiting: InvestorRequest = { ...redeem, epochStatus: open }
		const onCancel = vi.fn()
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
			{ onCancel },
		)

		result.waiting[0]?.actions[0]?.onPress()

		expect(onCancel).toHaveBeenCalledWith(waiting)
	})

	it("offers no cancel action once a deposit is priced and no longer waiting", () => {
		const result = toRequestEntriesByStage(
			{ requests: [deposit], archived: [], unreadable: [] },
			tokens,
			{ onCancel: () => {} },
		)

		expect(result.ready[0]?.actions).toEqual([])
	})

	it("offers no claim action on a ready deposit when no handler is given", () => {
		const result = toRequestEntriesByStage(
			{ requests: [deposit], archived: [], unreadable: [] },
			tokens,
		)

		expect(result.ready[0]?.actions).toEqual([])
	})

	it("offers a claim action on a ready deposit when a handler is given", () => {
		const onClaim = () => {}
		const result = toRequestEntriesByStage(
			{ requests: [deposit], archived: [], unreadable: [] },
			tokens,
			{ onClaim },
		)

		expect(result.ready[0]?.actions).toEqual([
			{ label: "Claim", kind: "primary", onPress: expect.any(Function) },
		])
	})

	it("presses the claim action with the exact request it belongs to", () => {
		const onClaim = vi.fn()
		const result = toRequestEntriesByStage(
			{ requests: [deposit], archived: [], unreadable: [] },
			tokens,
			{ onClaim },
		)

		result.ready[0]?.actions[0]?.onPress()

		expect(onClaim).toHaveBeenCalledWith(deposit)
	})

	it("offers a claim action on a ready redemption, now that claim_redeem is reachable", () => {
		const onClaim = () => {}
		const result = toRequestEntriesByStage(
			{ requests: [redeem], archived: [], unreadable: [] },
			tokens,
			{ onClaim },
		)

		expect(result.ready[0]?.actions).toEqual([
			{ label: "Claim", kind: "primary", onPress: expect.any(Function) },
		])
	})

	it("moves a held, unpriced request out of waiting into blocked, with no cancel action", () => {
		const waiting: InvestorRequest = { ...deposit, epochStatus: open }
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
			{
				outlookFor: () => ({ held: HELD_WHILE_FROZEN, cancellable: false }),
				onCancel: () => {},
			},
		)

		expect(result.waiting).toEqual([])
		expect(result.blocked[0]?.state).toBe("Held")
		expect(result.blocked[0]?.outAmount).toBe("Not yet priced")
		expect(result.blocked[0]?.actions).toEqual([])
	})

	it("offers no cancel action on a waiting request whose cancellation window is closed", () => {
		const waiting: InvestorRequest = { ...deposit, epochStatus: pending }
		const result = toRequestEntriesByStage(
			{ requests: [waiting], archived: [], unreadable: [] },
			tokens,
			{ outlookFor: () => ({ cancellable: false }), onCancel: () => {} },
		)

		expect(result.waiting[0]?.actions).toEqual([])
	})

	it("shows the outlook's claim note on a ready request instead of the default note", () => {
		const result = toRequestEntriesByStage(
			{ requests: [deposit], archived: [], unreadable: [] },
			tokens,
			{
				outlookFor: () => ({
					claimNote: "Queued instead.",
					cancellable: false,
				}),
				onClaim: () => {},
			},
		)

		expect(result.ready[0]?.note).toBe("Queued instead.")
		expect(result.ready[0]?.actions).toEqual([
			{ label: "Claim", kind: "primary", onPress: expect.any(Function) },
		])
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
				outLabel: "Owed to you",
				outAmount: "Could not read",
				outTone: "word",
				state: "Could not read",
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

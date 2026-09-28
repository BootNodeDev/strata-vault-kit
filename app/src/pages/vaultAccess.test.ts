import {
	AMOUNT_DECIMALS,
	type Amount,
	type NetworkState,
	type Price,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { type DepositBalance } from "../hooks/useDepositBalance"
import { type InvestorRequestsRead } from "../hooks/useInvestorRequests"
import { type Allowance } from "../hooks/useIsAllowed"
import { type NavClassification } from "../hooks/useNavPrice"
import { type SharePosition } from "../hooks/useSharePosition"
import {
	deriveAccess,
	emptyMessages,
	isSubscriptionOpen,
	toActionBalance,
	toPanelBlock,
	toPosition,
	toPriceBlock,
	type InvestorAccess,
	type SubscribeGate,
} from "./vaultAccess"

const address = "GINVESTORADDRESS1234567890"
const network = { appNetwork: "Testnet", walletNetwork: "Mainnet" }
const networkStates: NetworkState[] = [
	"disconnected",
	"mismatch",
	"ok",
	"unverified",
]
const allowances: Allowance[] = [
	"checking",
	"allowed",
	"not-allowed",
	"unreadable",
]

function expected(
	investorAddress: string | undefined,
	state: NetworkState,
	allowance: Allowance,
): InvestorAccess {
	if (investorAddress === undefined) return { status: "disconnected" }
	if (state === "mismatch") {
		return {
			status: "wrong-network",
			appNetwork: network.appNetwork,
			walletNetwork: network.walletNetwork,
		}
	}
	if (allowance === "checking") return { status: "checking" }
	if (allowance === "not-allowed") return { status: "not-allowed" }
	if (allowance === "unreadable") return { status: "unreadable" }
	return { status: "allowed" }
}

describe("deriveAccess", () => {
	const rows: [string | undefined, NetworkState, Allowance][] = []
	for (const investorAddress of [undefined, address]) {
		for (const state of networkStates) {
			for (const allowance of allowances) {
				rows.push([investorAddress, state, allowance])
			}
		}
	}

	it.each(rows)(
		"address=%s network=%s allowance=%s",
		(investorAddress, state, allowance) => {
			const result = deriveAccess({
				address: investorAddress,
				network: { state, ...network },
				allowance,
			})

			expect(result).toEqual(expected(investorAddress, state, allowance))
		},
	)

	it("resolves disconnected, never checking, when there is no address and the allowance read is still pending", () => {
		const result = deriveAccess({
			address: undefined,
			network: { state: "ok", ...network },
			allowance: "checking",
		})

		expect(result).toEqual({ status: "disconnected" })
	})
})

describe("toPanelBlock", () => {
	const onConnect = vi.fn()
	const onOpenWallet = vi.fn()
	const openGate: SubscribeGate = {
		isSubscribe: true,
		pause: "open",
		hasOpenSubscription: false,
	}

	it("offers a connect action while disconnected", () => {
		const block = toPanelBlock(
			{ status: "disconnected" },
			onConnect,
			onOpenWallet,
			openGate,
		)

		expect(block?.kind).toBe("action")
		if (block?.kind === "action") {
			block.onPress()
			expect(onConnect).toHaveBeenCalledOnce()
		}
	})

	it("names the app network in the wrong-network control", () => {
		const block = toPanelBlock(
			{
				status: "wrong-network",
				appNetwork: "Testnet",
				walletNetwork: "Mainnet",
			},
			onConnect,
			onOpenWallet,
			openGate,
		)

		expect(block?.kind).toBe("action")
		if (block?.kind === "action") {
			expect(block.label).toContain("Testnet")
			block.onPress()
			expect(onOpenWallet).toHaveBeenCalledOnce()
		}
	})

	it("shows a checking message distinguishable from a failure or a denial", () => {
		const block = toPanelBlock(
			{ status: "checking" },
			onConnect,
			onOpenWallet,
			openGate,
		)
		expect(block).toEqual({
			kind: "message",
			reason: "Checking whether this address may subscribe.",
			sides: ["subscribe", "redeem"],
		})
	})

	it("never states 'not allowed' for a failed read", () => {
		const block = toPanelBlock(
			{ status: "unreadable" },
			onConnect,
			onOpenWallet,
			openGate,
		)
		expect(block?.kind).toBe("message")
		expect(block?.reason).not.toMatch(/not allowed/i)
	})

	it("states a genuine not-allowed plainly, without reading as an error", () => {
		const block = toPanelBlock(
			{ status: "not-allowed" },
			onConnect,
			onOpenWallet,
			openGate,
		)
		expect(block?.kind).toBe("message")
		expect(block?.reason).toMatch(/allowlist/i)
	})

	it("returns no block once allowed, unpaused, and with no open subscription", () => {
		expect(
			toPanelBlock({ status: "allowed" }, onConnect, onOpenWallet, openGate),
		).toBeUndefined()
	})

	it("states a genuine not-allowed before either subscribe gate reason", () => {
		const block = toPanelBlock(
			{ status: "not-allowed" },
			onConnect,
			onOpenWallet,
			{ isSubscribe: true, pause: "paused", hasOpenSubscription: true },
		)
		expect(block?.reason).toMatch(/allowlist/i)
	})

	describe("subscribe gate", () => {
		it("blocks with a checking message while the pause read is in flight", () => {
			const block = toPanelBlock(
				{ status: "allowed" },
				onConnect,
				onOpenWallet,
				{ ...openGate, pause: "checking" },
			)
			expect(block).toEqual({
				kind: "message",
				reason: "Checking whether the vault is accepting requests.",
				sides: ["subscribe"],
			})
		})

		it("blocks with a distinct message when the pause read fails", () => {
			const block = toPanelBlock(
				{ status: "allowed" },
				onConnect,
				onOpenWallet,
				{ ...openGate, pause: "unreadable" },
			)
			expect(block).toEqual({
				kind: "message",
				reason:
					"Could not check whether the vault is accepting requests. Try again shortly.",
				sides: ["subscribe"],
			})
		})

		it("blocks while the vault is paused", () => {
			const block = toPanelBlock(
				{ status: "allowed" },
				onConnect,
				onOpenWallet,
				{ ...openGate, pause: "paused" },
			)
			expect(block).toEqual({
				kind: "message",
				reason: "The vault is not accepting new requests right now.",
				sides: ["subscribe"],
			})
		})

		it("blocks while a subscription is already open in the current batch", () => {
			const block = toPanelBlock(
				{ status: "allowed" },
				onConnect,
				onOpenWallet,
				{ ...openGate, hasOpenSubscription: true },
			)
			expect(block).toEqual({
				kind: "message",
				reason: "You already have a subscription request open in this batch.",
				sides: ["subscribe"],
			})
		})

		it("scopes the pause block to the subscribe side only, so the redeem side stays reachable", () => {
			const block = toPanelBlock(
				{ status: "allowed" },
				onConnect,
				onOpenWallet,
				{ ...openGate, pause: "paused" },
			)
			expect(block?.kind).toBe("message")
			if (block?.kind === "message") {
				expect(block.sides).toEqual(["subscribe"])
			}
		})

		it("states the pause reason before the open-subscription reason when both apply", () => {
			const block = toPanelBlock(
				{ status: "allowed" },
				onConnect,
				onOpenWallet,
				{ isSubscribe: true, pause: "paused", hasOpenSubscription: true },
			)
			expect(block?.reason).toMatch(/accepting new requests/i)
		})

		it("never gates the redeem side on pause or an open subscription", () => {
			const block = toPanelBlock(
				{ status: "allowed" },
				onConnect,
				onOpenWallet,
				{ isSubscribe: false, pause: "paused", hasOpenSubscription: true },
			)
			expect(block).toBeUndefined()
		})
	})
})

describe("isSubscriptionOpen", () => {
	const checking: InvestorRequestsRead = { status: "checking" }

	it("is false before the investor's requests resolve", () => {
		expect(isSubscriptionOpen(checking)).toBe(false)
	})

	it("is true when a deposit request is open in the current batch", () => {
		const requests: InvestorRequestsRead = {
			status: "loaded",
			requests: [
				{
					epochId: 2n,
					side: "deposit",
					epochStatus: { tag: "Open", values: undefined },
					sharePrice: 0n as Price,
					amount: 100_0000000n as Amount,
					claimed: false,
				},
			],
			archived: [],
			unreadable: [],
		}
		expect(isSubscriptionOpen(requests)).toBe(true)
	})

	it("is false when only a redemption is open in the current batch", () => {
		const requests: InvestorRequestsRead = {
			status: "loaded",
			requests: [
				{
					epochId: 2n,
					side: "redeem",
					epochStatus: { tag: "Open", values: undefined },
					sharePrice: 0n as Price,
					amount: 500_0000000n as Amount,
					claimed: false,
				},
			],
			archived: [],
			unreadable: [],
		}
		expect(isSubscriptionOpen(requests)).toBe(false)
	})

	it("is false for a deposit request left over from a closed batch", () => {
		const requests: InvestorRequestsRead = {
			status: "loaded",
			requests: [
				{
					epochId: 1n,
					side: "deposit",
					epochStatus: { tag: "Pending", values: undefined },
					sharePrice: 0n as Price,
					amount: 100_0000000n as Amount,
					claimed: false,
				},
			],
			archived: [],
			unreadable: [],
		}
		expect(isSubscriptionOpen(requests)).toBe(false)
	})
})

describe("toPriceBlock", () => {
	it("shows a distinct reading message while pending", () => {
		expect(toPriceBlock(undefined, true)).toEqual({
			kind: "message",
			reason: "Reading the vault's price.",
			sides: ["subscribe", "redeem"],
		})
	})

	it("blocks on any non-valid price once resolved, on both sides", () => {
		const notValid: NavClassification = { status: "paused" }
		const block = toPriceBlock(notValid, false)
		expect(block?.kind).toBe("message")
		if (block?.kind === "message") {
			expect(block.sides).toEqual(["subscribe", "redeem"])
		}
	})

	it("returns no block once the price is valid", () => {
		const valid: NavClassification = {
			status: "valid",
			price: 1n as never,
			attestedAt: 0n,
		}
		expect(toPriceBlock(valid, false)).toBeUndefined()
	})
})

describe("toPosition", () => {
	it("shows no value and connect copy while disconnected", () => {
		expect(toPosition({ status: "disconnected" }, "vUSDC")).toEqual({
			value: null,
			note: "Connect a wallet to see your position.",
		})
	})

	it("shows pending, and no value, while the read is in flight", () => {
		expect(toPosition({ status: "checking" }, "vUSDC")).toEqual({
			value: null,
			pending: true,
		})
	})

	it("shows no value and a distinct note when the read fails", () => {
		expect(toPosition({ status: "unreadable" }, "vUSDC")).toEqual({
			value: null,
			note: "Could not read your share balance.",
		})
	})

	it("renders a genuine zero as a formatted zero, not the absence indicator", () => {
		const position: SharePosition = {
			status: "held",
			shares: 0n as Amount,
		}
		expect(toPosition(position, "vUSDC")).toEqual({ value: "0.00 vUSDC" })
	})

	it("renders a non-zero holding using the reported share symbol", () => {
		const position: SharePosition = {
			status: "held",
			shares: (500n * 10n ** BigInt(AMOUNT_DECIMALS)) as Amount,
		}
		expect(toPosition(position, "vUSDC")).toEqual({ value: "500.00 vUSDC" })
	})
})

describe("toActionBalance", () => {
	const held: SharePosition = {
		status: "held",
		shares: (500n * 10n ** BigInt(AMOUNT_DECIMALS)) as Amount,
	}
	const depositHeld: DepositBalance = {
		status: "held",
		amount: (250n * 10n ** BigInt(AMOUNT_DECIMALS)) as Amount,
	}

	it("reads the deposit asset's balance on the subscribe side", () => {
		expect(
			toActionBalance(true, false, depositHeld, { status: "checking" }),
		).toBe(250)
	})

	it("reads the share position's balance on the redeem side", () => {
		expect(toActionBalance(false, false, { status: "checking" }, held)).toBe(
			500,
		)
	})

	it("returns no balance while the panel is blocked, on either side", () => {
		expect(toActionBalance(true, true, depositHeld, held)).toBeNull()
		expect(toActionBalance(false, true, depositHeld, held)).toBeNull()
	})

	it("returns no balance while the relevant read has not resolved to a value", () => {
		expect(
			toActionBalance(true, false, { status: "checking" }, held),
		).toBeNull()
		expect(
			toActionBalance(true, false, { status: "unreadable" }, held),
		).toBeNull()
		expect(
			toActionBalance(false, false, depositHeld, { status: "disconnected" }),
		).toBeNull()
	})
})

describe("emptyMessages", () => {
	it("names the missing wallet while disconnected", () => {
		const messages = emptyMessages("disconnected")
		expect(messages.ready).toMatch(/wallet/i)
		expect(messages.waiting).toMatch(/wallet/i)
		expect(messages.blocked).toMatch(/wallet/i)
	})

	it("uses distinct copy once loaded", () => {
		const disconnected = emptyMessages("disconnected")
		const loaded = emptyMessages("loaded")
		expect(loaded.ready).not.toBe(disconnected.ready)
		expect(loaded.waiting).not.toBe(disconnected.waiting)
		expect(loaded.blocked).not.toBe(disconnected.blocked)
	})

	it("distinguishes a failed read from a genuine empty one", () => {
		const unreadable = emptyMessages("unreadable")
		const loaded = emptyMessages("loaded")
		expect(unreadable.ready).not.toBe(loaded.ready)
		expect(unreadable.waiting).not.toBe(loaded.waiting)
		expect(unreadable.blocked).not.toBe(loaded.blocked)
	})

	it("distinguishes checking from both loaded and unreadable", () => {
		const checking = emptyMessages("checking")
		const loaded = emptyMessages("loaded")
		const unreadable = emptyMessages("unreadable")
		expect(checking.ready).not.toBe(loaded.ready)
		expect(checking.ready).not.toBe(unreadable.ready)
	})
})

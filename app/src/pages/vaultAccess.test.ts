import { type NetworkState } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { type Allowance } from "../hooks/useIsAllowed"
import { type NavClassification } from "../hooks/useNavPrice"
import {
	deriveAccess,
	emptyMessages,
	toPanelBlock,
	toPriceBlock,
	type InvestorAccess,
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

	it("offers a connect action while disconnected", () => {
		const block = toPanelBlock(
			{ status: "disconnected" },
			onConnect,
			onOpenWallet,
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
		)

		expect(block?.kind).toBe("action")
		if (block?.kind === "action") {
			expect(block.label).toContain("Testnet")
			block.onPress()
			expect(onOpenWallet).toHaveBeenCalledOnce()
		}
	})

	it("shows a checking message distinguishable from a failure or a denial", () => {
		const block = toPanelBlock({ status: "checking" }, onConnect, onOpenWallet)
		expect(block).toEqual({
			kind: "message",
			reason: "Checking whether this address may subscribe.",
		})
	})

	it("never states 'not allowed' for a failed read", () => {
		const block = toPanelBlock(
			{ status: "unreadable" },
			onConnect,
			onOpenWallet,
		)
		expect(block?.kind).toBe("message")
		expect(block?.reason).not.toMatch(/not allowed/i)
	})

	it("states a genuine not-allowed plainly, without reading as an error", () => {
		const block = toPanelBlock(
			{ status: "not-allowed" },
			onConnect,
			onOpenWallet,
		)
		expect(block?.kind).toBe("message")
		expect(block?.reason).toMatch(/allowlist/i)
	})

	it("returns no block once allowed", () => {
		expect(
			toPanelBlock({ status: "allowed" }, onConnect, onOpenWallet),
		).toBeUndefined()
	})
})

describe("toPriceBlock", () => {
	it("shows a distinct reading message while pending", () => {
		expect(toPriceBlock(undefined, true)).toEqual({
			kind: "message",
			reason: "Reading the vault's price.",
		})
	})

	it("blocks on any non-valid price once resolved", () => {
		const notValid: NavClassification = { status: "paused" }
		const block = toPriceBlock(notValid, false)
		expect(block?.kind).toBe("message")
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

describe("emptyMessages", () => {
	it("names the missing wallet while disconnected", () => {
		const messages = emptyMessages(false)
		expect(messages.ready).toMatch(/wallet/i)
		expect(messages.waiting).toMatch(/wallet/i)
	})

	it("uses distinct copy once connected", () => {
		const disconnected = emptyMessages(false)
		const connected = emptyMessages(true)
		expect(connected.ready).not.toBe(disconnected.ready)
		expect(connected.waiting).not.toBe(disconnected.waiting)
	})
})

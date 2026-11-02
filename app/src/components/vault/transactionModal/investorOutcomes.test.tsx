import { type Amount } from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import TransactionModal from "../TransactionModal"
import {
	renderModal,
	renderCancelModal,
	renderCancelRedeemModal,
	renderClaimModal,
	renderRedeemModal,
	renderClaimRedeemModal,
	renderClaimWindDownModal,
} from "./renderModal"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: () => null,
}))

describe("TransactionModal, allowlist and freeze refusals", () => {
	const contractError = (code: number) => ({
		status: "failed" as const,
		failure: { kind: "contract-error" as const, code },
	})

	it("names NotAllowlisted on a subscription as an address that cannot subscribe", () => {
		renderModal(contractError(6068))

		expect(screen.getByText(/not allowlisted/)).toBeTruthy()
		expect(screen.getByText(/can subscribe/)).toBeTruthy()
	})

	it("names Frozen on a subscription as a frozen address", () => {
		renderModal(contractError(6071))

		expect(screen.getByText(/frozen/)).toBeTruthy()
		expect(screen.getByText(/cannot subscribe/)).toBeTruthy()
	})

	it("names Frozen on a redemption request as a frozen address or frozen shares", () => {
		renderRedeemModal(contractError(6071))

		expect(screen.getByText(/shares are frozen/)).toBeTruthy()
		expect(screen.getByText(/free shares/)).toBeTruthy()
	})

	it.each<[string, () => void]>([
		["cancelling a subscription", () => renderCancelModal(contractError(6071))],
		[
			"cancelling a redemption",
			() => renderCancelRedeemModal(contractError(6071)),
		],
		["claiming shares", () => renderClaimModal(contractError(6071))],
		[
			"claiming a redemption",
			() => renderClaimRedeemModal(contractError(6071)),
		],
	])("names Frozen on %s as held until the freeze lifts", (_name, render) => {
		render()

		expect(screen.getByText(/held until the freeze is lifted/)).toBeTruthy()
	})

	it("falls back to a generic refusal for NotAllowlisted on a subscription cancellation, since a delisted holder may still cancel", () => {
		renderCancelModal(contractError(6068))

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/allowlisted/)).toBeNull()
	})
})

describe("TransactionModal, conversion and surrender outcomes", () => {
	it("tells a delisted investor their claimed shares were queued as a redemption", () => {
		renderClaimModal({
			status: "confirmed",
			sharesMinted: 0n as Amount,
			queuedInto: 5n,
		})

		expect(
			screen.getByRole("heading", { name: "Queued as a redemption" }),
		).toBeTruthy()
		expect(screen.getByText(/not allowlisted/)).toBeTruthy()
		expect(screen.getByText(/pay out in USDC at the next price/)).toBeTruthy()
		expect(screen.queryByText(/returned to your wallet/)).toBeNull()
	})

	it("tells a delisted investor in a wind-down their claimed shares joined the wind-down claim", () => {
		renderClaimModal({
			status: "confirmed",
			sharesMinted: 0n as Amount,
			queuedInto: 0n,
		})

		expect(
			screen.getByRole("heading", { name: "Moved to your wind-down claim" }),
		).toBeTruthy()
		expect(screen.getByText(/not allowlisted/)).toBeTruthy()
	})

	it("still reads a zero-share claim without a conversion as a returned deposit", () => {
		renderClaimModal({ status: "confirmed", sharesMinted: 0n as Amount })

		expect(
			screen.getByRole("heading", { name: "Deposit returned" }),
		).toBeTruthy()
	})

	it("tells the investor a cancelled redemption moved into the wind-down claim", () => {
		renderCancelRedeemModal({
			status: "confirmed",
			returnedShares: 100_0000000n as Amount,
			surrendered: true,
		})

		expect(
			screen.getByRole("heading", { name: "Moved to your wind-down claim" }),
		).toBeTruthy()
		expect(screen.getByText(/winding down/)).toBeTruthy()
		expect(screen.queryByText(/returned to your wallet/)).toBeNull()
	})

	it("still reads a returned redemption as cancelled", () => {
		renderCancelRedeemModal({
			status: "confirmed",
			returnedShares: 100_0000000n as Amount,
			surrendered: false,
		})

		expect(
			screen.getByRole("heading", { name: "Request cancelled" }),
		).toBeTruthy()
	})
})

describe("TransactionModal, wind-down outcomes", () => {
	it("tells the investor a zero-price claim burned the shares during a wind-down, never that they came back", () => {
		renderClaimRedeemModal({
			status: "confirmed",
			assetsClaimed: 0n as Amount,
			sharesReturned: false,
		})

		expect(
			screen.getByRole("heading", { name: "Nothing to pay out" }),
		).toBeTruthy()
		expect(screen.getByText(/winding down/)).toBeTruthy()
		expect(screen.getByText(/burned/)).toBeTruthy()
		expect(screen.queryByText(/returned to your wallet/)).toBeNull()
	})
})

describe("TransactionModal, cancelling a redemption in a wind-down", () => {
	it("tells the signer the shares move into the wind-down claim, never that they return", () => {
		render(
			<TransactionModal
				action="cancel-redeem"
				status={{ status: "awaiting-signature" }}
				amount="100.00"
				ticker="vUSDC"
				assetTicker="USDC"
				windingDown
				onClose={vi.fn()}
				onRetry={vi.fn()}
			/>,
		)

		expect(screen.getByText(/wind-down claim/)).toBeTruthy()
		expect(screen.queryByText(/returns/)).toBeNull()
	})
})

describe("TransactionModal, claiming from the wind-down", () => {
	it("tells the signer what they receive and that their shares are turned in", () => {
		renderClaimWindDownModal({ status: "awaiting-signature" })

		expect(screen.getByText(/25\.00 USDC/)).toBeTruthy()
		expect(screen.getByText(/turns in your unfrozen vUSDC/)).toBeTruthy()
	})

	it("shows the assets paid and the shares turned in once confirmed", () => {
		renderClaimWindDownModal({
			status: "confirmed",
			assetsClaimed: 25_0000000n as Amount,
			sharesSurrendered: 40_0000000n as Amount,
		})

		expect(screen.getByRole("heading", { name: "USDC claimed" })).toBeTruthy()
		expect(screen.getByText(/25\.00 USDC has been added/)).toBeTruthy()
		expect(screen.getByText(/40\.00 vUSDC/)).toBeTruthy()
	})

	it("reads a claim that paid nothing as shares turned in for later rounds", () => {
		renderClaimWindDownModal({
			status: "confirmed",
			assetsClaimed: 0n as Amount,
			sharesSurrendered: 40_0000000n as Amount,
		})

		expect(
			screen.getByRole("heading", { name: "Shares turned in" }),
		).toBeTruthy()
		expect(screen.getByText(/later rounds/)).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[6051, /first payout/],
		[6054, /nothing to claim from the wind-down/],
		[6071, /held until the freeze is lifted/],
	])("names refusal %i in the dapp's words", (code, text) => {
		renderClaimWindDownModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(screen.getByText(text)).toBeTruthy()
	})

	it("falls back to a generic refusal for a wind-down claim error it does not recognize", () => {
		renderClaimWindDownModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
	})
})

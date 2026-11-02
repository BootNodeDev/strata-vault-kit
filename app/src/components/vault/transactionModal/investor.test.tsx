import { type Amount } from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
	renderCancelModal,
	renderCancelRedeemModal,
	renderClaimModal,
	renderRedeemModal,
	renderClaimRedeemModal,
} from "./renderModal"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: () => null,
}))

describe("TransactionModal, cancelling", () => {
	it("opens with a preparing state naming the cancellation, not the request", () => {
		renderCancelModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing your cancellation" }),
		).toBeTruthy()
	})

	it("tells the investor their deposit returns to their wallet, honestly, without escrow or pricing language", () => {
		renderCancelModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
		expect(screen.getByText(/from escrow/)).toBeTruthy()
		expect(screen.queryByText(/into escrow/)).toBeNull()
		expect(screen.getByText(/withdrawn, not priced/)).toBeTruthy()
	})

	it("tells the investor the cancellation is on its way, distinct from the subscribe copy", () => {
		renderCancelModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending your cancellation" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("shows the returned amount once confirmed, with no batch or pricing claim", () => {
		renderCancelModal({
			status: "confirmed",
			refundedAmount: 150_0000000n as Amount,
			hash: "b".repeat(64),
		})

		expect(
			screen.getByRole("heading", { name: "Request cancelled" }),
		).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
		expect(screen.queryByText(/Batch/)).toBeNull()
		expect(screen.queryByText(/attestation/)).toBeNull()
		expect(screen.queryByText(/Epoch/)).toBeNull()
	})

	it("reports the amount the vault returned, not the one captured when the investor pressed cancel", () => {
		renderCancelModal({
			status: "confirmed",
			refundedAmount: 275_5000000n as Amount,
			hash: "b".repeat(64),
		})

		expect(screen.getByText(/275\.50 USDC/)).toBeTruthy()
		expect(screen.queryByText(/150\.00/)).toBeNull()
	})

	it("renders the refunded amount at full precision, not rounded to two fraction digits", () => {
		renderCancelModal({
			status: "confirmed",
			refundedAmount: 952380952n as Amount,
			hash: "b".repeat(64),
		})

		expect(screen.getByText(/95\.2380952 USDC/)).toBeTruthy()
	})

	it("names the vault's own reason for a cancel-specific contract refusal, distinct from subscribe's codes", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6039 },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(
			screen.getByText(/already been priced. Claim your shares instead/),
		).toBeTruthy()
	})

	it("names PriceAvailable distinctly from AlreadyPriced, without sending the investor to claim yet", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6041 },
		})

		expect(screen.getByText(/A price is available/)).toBeTruthy()
		expect(screen.getByText(/claimable once it is/)).toBeTruthy()
		expect(screen.queryByText(/Claim your shares instead/)).toBeNull()
	})

	it("names RequestNotFound for a cancellation of a request that no longer exists", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6001 },
		})

		expect(screen.getByText(/no longer exists to cancel/)).toBeTruthy()
	})

	it("names EpochNotFound as a request that could not be found", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6029 },
		})

		expect(screen.getByText(/This request could not be found/)).toBeTruthy()
	})

	it("names EscrowNotCovered as a deposit the vault cannot return until it is funded again", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6076 },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(
			screen.getByText(/You can cancel once it is funded again/),
		).toBeTruthy()
	})

	it("falls back to a generic refusal for a cancel error it does not recognize, without the raw code", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
	})

	it("falls back to a generic refusal for 304 on a deposit cancellation, since only the share token's identity check can raise it", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/304/)).toBeNull()
		expect(screen.queryByText(/shares cannot be returned/)).toBeNull()
	})

	it("reads a declined cancellation as a choice, not a failure, and offers to try again", () => {
		const { onRetry } = renderCancelModal({
			status: "failed",
			failure: { kind: "declined" },
		})

		expect(
			screen.getByRole("heading", { name: "You declined the request" }),
		).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Try again" }))
		expect(onRetry).toHaveBeenCalledTimes(1)
	})

	it("shows the same step progress machinery for a cancellation in flight", () => {
		renderCancelModal({ status: "awaiting-signature" })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, in progress",
			"Sent to the network",
			"Recorded",
		])
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderCancelModal({ status: "awaiting-signature" })

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, cancelling a redemption", () => {
	it("opens with a preparing state naming the cancellation", () => {
		renderCancelRedeemModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing your cancellation" }),
		).toBeTruthy()
	})

	it("tells the investor their shares return to their wallet, honestly, without escrow or pricing language", () => {
		renderCancelRedeemModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(screen.getByText(/100\.00 vUSDC/)).toBeTruthy()
		expect(screen.getByText(/from escrow/)).toBeTruthy()
		expect(screen.queryByText(/into escrow/)).toBeNull()
		expect(screen.getByText(/withdrawn, not priced/)).toBeTruthy()
	})

	it("shows the returned shares, in the share ticker, once confirmed", () => {
		renderCancelRedeemModal({
			status: "confirmed",
			returnedShares: 100_0000000n as Amount,
			surrendered: false,
			hash: "b".repeat(64),
		})

		expect(
			screen.getByRole("heading", { name: "Request cancelled" }),
		).toBeTruthy()
		expect(screen.getByText(/100\.00 vUSDC/)).toBeTruthy()
		expect(screen.queryByText(/Batch/)).toBeNull()
	})

	it("renders the returned shares at full precision, not rounded to two fraction digits", () => {
		renderCancelRedeemModal({
			status: "confirmed",
			returnedShares: 952380952n as Amount,
			surrendered: false,
			hash: "b".repeat(64),
		})

		expect(screen.getByText(/95\.2380952 vUSDC/)).toBeTruthy()
	})

	it("names the vault's own reason for a cancel-specific contract refusal, reusing the same table as cancelling a deposit", () => {
		renderCancelRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6039 },
		})

		expect(
			screen.getByText(/already been priced. Claim your shares instead/),
		).toBeTruthy()
	})

	it("names NotAllowlisted as a delisted holder whose shares stay queued, pointing to the cash claim instead", () => {
		renderCancelRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6068 },
		})

		expect(screen.getByText(/not allowlisted/)).toBeTruthy()
		expect(screen.getByText(/claim the USDC/i)).toBeTruthy()
	})

	it("names HolderNotEligible as shares the address cannot receive, pointing to the cash claim instead", () => {
		renderCancelRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6073 },
		})

		expect(
			screen.getByText(/cannot receive these shares right now/),
		).toBeTruthy()
		expect(screen.getByText(/claim the USDC/i)).toBeTruthy()
	})

	it("falls back to a generic refusal for 304 on a withdrawal cancellation, since the vault checks the holder itself", () => {
		renderCancelRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/allowlisted/)).toBeNull()
	})

	it("falls back to a generic refusal for a cancel-redeem error it does not recognize, without the raw code", () => {
		renderCancelRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderCancelRedeemModal({
			status: "awaiting-signature",
		})

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, claiming", () => {
	it("opens with a preparing state naming the claim", () => {
		renderClaimModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing your claim" }),
		).toBeTruthy()
	})

	it("tells the investor what claiming means before they sign, including the refund path, without naming an epoch", () => {
		renderClaimModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"You receive what you're owed. If the price leaves no shares to claim, 150.00 USDC returns to your wallet instead.",
			),
		).toBeTruthy()
		expect(screen.queryByText(/Epoch/)).toBeNull()
		expect(screen.queryByText(/epoch/)).toBeNull()
	})

	it("tells the investor the claim is on its way, distinct from subscribe and cancel copy", () => {
		renderClaimModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending your claim" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("shows the shares minted in the share token, not the deposit token, once confirmed", () => {
		renderClaimModal({
			status: "confirmed",
			sharesMinted: 100_0000000n as Amount,
			hash: "b".repeat(64),
		})

		expect(screen.getByRole("heading", { name: "Shares claimed" })).toBeTruthy()
		expect(screen.getByText(/100\.00 vUSDC/)).toBeTruthy()
		expect(screen.queryByText(/150\.00 USDC/)).toBeNull()
	})

	it("renders the shares minted at full precision, not rounded to two fraction digits", () => {
		renderClaimModal({
			status: "confirmed",
			sharesMinted: 952380952n as Amount,
			hash: "b".repeat(64),
		})

		expect(screen.getByText(/95\.2380952 vUSDC/)).toBeTruthy()
	})

	it("tells the investor their deposit came back, not that shares were issued, on a zero result", () => {
		renderClaimModal({
			status: "confirmed",
			sharesMinted: 0n as Amount,
			hash: "b".repeat(64),
		})

		expect(
			screen.getByRole("heading", { name: "Deposit returned" }),
		).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
		expect(screen.queryByText(/vUSDC/)).toBeNull()
	})

	it("names RequestNotFound for a claim with no matching request", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6001 },
		})

		expect(screen.getByText(/no request to claim/)).toBeTruthy()
	})

	it("names EpochNotFound as a request that could not be found", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6029 },
		})

		expect(screen.getByText(/This request could not be found/)).toBeTruthy()
	})

	it("names InvalidSharePrice as no valid price published yet", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6031 },
		})

		expect(screen.getByText(/not published a valid price/)).toBeTruthy()
	})

	it("names AlreadyClaimed distinctly", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6035 },
		})

		expect(screen.getByText(/already been claimed/)).toBeTruthy()
	})

	it("names ClaimNotCovered as the reserve not yet covering this claim", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6037 },
		})

		expect(screen.getByText(/not yet hold enough in reserve/)).toBeTruthy()
	})

	it("names AmountTooLarge as the conversion overflowing", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6014 },
		})

		expect(screen.getByText(/too large to complete/)).toBeTruthy()
	})

	it("falls back to a generic refusal for 304 on a share claim, since a delisted holder's shares join an exit instead", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/allowlisted/)).toBeNull()
	})

	it("falls back to a generic refusal for a claim error it does not recognize, without the raw code", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
	})

	it("reads a declined claim as a choice, not a failure, and offers to try again", () => {
		const { onRetry } = renderClaimModal({
			status: "failed",
			failure: { kind: "declined" },
		})

		expect(
			screen.getByRole("heading", { name: "You declined the request" }),
		).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Try again" }))
		expect(onRetry).toHaveBeenCalledTimes(1)
	})

	it("shows the same step progress machinery for a claim in flight", () => {
		renderClaimModal({ status: "awaiting-signature" })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, in progress",
			"Sent to the network",
			"Recorded",
		])
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderClaimModal({ status: "awaiting-signature" })

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, redeeming", () => {
	it("opens with a preparing state naming the redemption request", () => {
		renderRedeemModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", {
				name: "Preparing your redemption request",
			}),
		).toBeTruthy()
	})

	it("tells the investor their shares are locked in escrow, in share terms, without naming an epoch", () => {
		renderRedeemModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(screen.getByText(/100\.00 vUSDC/)).toBeTruthy()
		expect(screen.getByText(/in escrow/)).toBeTruthy()
		expect(screen.getByText(/not today/)).toBeTruthy()
		expect(screen.queryByText(/Epoch/)).toBeNull()
		expect(screen.queryByText(/epoch/)).toBeNull()
		expect(screen.queryByText(/batch/i)).toBeNull()
	})

	it("tells the investor the redemption request is on its way, distinct from subscribe copy", () => {
		renderRedeemModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending your redemption request" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("shows the confirmed shares and transaction hash once confirmed", () => {
		renderRedeemModal({
			status: "confirmed",
			hash: "b".repeat(64),
		})

		expect(
			screen.getByRole("heading", { name: "Redemption request submitted" }),
		).toBeTruthy()
		expect(screen.getByText(/100\.00 vUSDC/)).toBeTruthy()
		expect(screen.queryByText(/Batch/)).toBeNull()
		expect(screen.getByText(/bbbb\.\.\.bbbb/)).toBeTruthy()
	})

	it("never mentions locking or attestation once confirmed", () => {
		renderRedeemModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(screen.queryByText(/locked/i)).toBeNull()
		expect(screen.queryByText(/attestation/i)).toBeNull()
	})

	it("names InvalidAmount for a non-positive share amount", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6007 },
		})

		expect(screen.getByText(/amount greater than zero/)).toBeTruthy()
	})

	it("names RequestOutstanding as a redemption request already open, distinct from subscribe's wording", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6009 },
		})

		expect(
			screen.getByText(/already have a redemption request open/),
		).toBeTruthy()
	})

	it("names AmountTooLarge as too large for the vault to accept", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6014 },
		})

		expect(screen.getByText(/too large for the vault to accept/)).toBeTruthy()
	})

	it("names EpochNotFound as a request that could not be found", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6029 },
		})

		expect(screen.getByText(/This request could not be found/)).toBeTruthy()
	})

	it("names WindDownActive as the vault not accepting new redemptions", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6046 },
		})

		expect(screen.getByText(/not accepting new redemptions/)).toBeTruthy()
	})

	it("names SetupOpen as redemptions starting once setup closes", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6064 },
		})

		expect(screen.getByText(/setup is still open/)).toBeTruthy()
		expect(screen.getByText(/Redemptions start once it closes/)).toBeTruthy()
	})

	it("falls back to a generic refusal for a redeem error it does not recognize, without the raw code", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
	})

	it("reads a declined redemption request as a choice, not a failure, and offers to try again", () => {
		const { onRetry } = renderRedeemModal({
			status: "failed",
			failure: { kind: "declined" },
		})

		expect(
			screen.getByRole("heading", { name: "You declined the request" }),
		).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Try again" }))
		expect(onRetry).toHaveBeenCalledTimes(1)
	})

	it("shows the same step progress machinery for a redemption request in flight", () => {
		renderRedeemModal({ status: "awaiting-signature" })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, in progress",
			"Sent to the network",
			"Recorded",
		])
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderRedeemModal({ status: "awaiting-signature" })

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, claiming a redemption", () => {
	it("opens with a preparing state naming the claim", () => {
		renderClaimRedeemModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing your claim" }),
		).toBeTruthy()
	})

	it("tells the investor what claiming sends them, without naming an epoch", () => {
		renderClaimRedeemModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"You receive what you're owed. Signing sends 100.00 USDC to your wallet.",
			),
		).toBeTruthy()
		expect(screen.queryByText(/Epoch/)).toBeNull()
		expect(screen.queryByText(/epoch/)).toBeNull()
	})

	it("tells the investor the claim is on its way to the network", () => {
		renderClaimRedeemModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending your claim" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("shows the claimed asset, in its own ticker, once confirmed", () => {
		renderClaimRedeemModal({
			status: "confirmed",
			assetsClaimed: 150_0000000n as Amount,
			sharesReturned: false,
			hash: "b".repeat(64),
		})

		expect(screen.getByRole("heading", { name: "USDC claimed" })).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
	})

	it("renders the claimed asset amount at full precision, not rounded to two fraction digits", () => {
		renderClaimRedeemModal({
			status: "confirmed",
			assetsClaimed: 952380952n as Amount,
			sharesReturned: false,
			hash: "b".repeat(64),
		})

		expect(screen.getByText(/95\.2380952 USDC/)).toBeTruthy()
	})

	it("tells the investor their shares came back, not that an asset was claimed, on a zero result", () => {
		renderClaimRedeemModal({
			status: "confirmed",
			assetsClaimed: 0n as Amount,
			sharesReturned: true,
			hash: "b".repeat(64),
		})

		expect(
			screen.getByRole("heading", { name: "Shares returned" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"The price left nothing to claim, so your shares have been returned to your wallet instead.",
			),
		).toBeTruthy()
		expect(screen.queryByText(/USDC claimed/)).toBeNull()
	})

	it("names EpochNotFulfilled as not yet priced", () => {
		renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6034 },
		})

		expect(screen.getByText(/has not priced yet/)).toBeTruthy()
	})

	it("names ClaimNotCovered with the deposit asset's ticker, distinct from the untickered claim wording for the same code", () => {
		renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6037 },
		})

		expect(screen.getByText(/enough USDC in reserve/)).toBeTruthy()
	})

	it("names HolderNotEligible as the zero-price return the address cannot receive, in the same words as a withdrawal cancellation", () => {
		renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6073 },
		})

		expect(screen.getByText(/tried to return your shares/)).toBeTruthy()
		expect(
			screen.getByText(/cannot receive these shares right now/),
		).toBeTruthy()
		expect(screen.queryByText(/claim the USDC/i)).toBeNull()
	})

	it("falls back to a generic refusal for 304 on a withdrawal claim, since the vault checks the holder itself", () => {
		renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/allowlisted/)).toBeNull()
	})

	it("names AlreadyClaimed by delegating to the shared claim wording", () => {
		renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6035 },
		})

		expect(screen.getByText(/already been claimed/)).toBeTruthy()
	})

	it("falls back to a generic refusal for a claim-redeem error it does not recognize, without the raw code", () => {
		renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
	})

	it("reads a declined claim as a choice, not a failure, and offers to try again", () => {
		const { onRetry } = renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "declined" },
		})

		expect(
			screen.getByRole("heading", { name: "You declined the request" }),
		).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Try again" }))
		expect(onRetry).toHaveBeenCalledTimes(1)
	})

	it("shows the same step progress machinery for a claim in flight", () => {
		renderClaimRedeemModal({ status: "awaiting-signature" })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, in progress",
			"Sent to the network",
			"Recorded",
		])
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderClaimRedeemModal({
			status: "awaiting-signature",
		})

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

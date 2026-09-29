import { type Amount } from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type CancelDepositStatus } from "../../hooks/useCancelDeposit"
import { type ClaimDepositStatus } from "../../hooks/useClaimDeposit"
import { type RequestDepositStatus } from "../../hooks/useRequestDeposit"
import { type RequestRedeemStatus } from "../../hooks/useRequestRedeem"
import TransactionModal from "./TransactionModal"

const { explorerTransactionMock } = vi.hoisted(() => ({
	explorerTransactionMock: vi.fn(() => null as string | null),
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: explorerTransactionMock,
}))

const renderModal = (status: RequestDepositStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="subscribe"
			status={status}
			amount="150.00"
			ticker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderCancelModal = (status: CancelDepositStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="cancel"
			status={status}
			amount="150.00"
			ticker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderClaimModal = (status: ClaimDepositStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="claim"
			status={status}
			amount="150.00"
			ticker="USDC"
			shareTicker="vUSDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderRedeemModal = (status: RequestRedeemStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="redeem"
			status={status}
			amount="100.00"
			ticker="vUSDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

describe("TransactionModal", () => {
	it("renders nothing while idle", () => {
		renderModal({ status: "idle" })

		expect(screen.queryByRole("dialog")).toBeNull()
	})

	it("opens with a preparing state before any signature has been requested", () => {
		renderModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing your request" }),
		).toBeTruthy()
		expect(screen.queryByText(/Transaction/)).toBeNull()
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
	})

	it("tells the investor what they are signing and the amount going in", () => {
		renderModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
		expect(screen.getByText(/into escrow/)).toBeTruthy()
		expect(screen.getByText(/once this batch is priced/)).toBeTruthy()
	})

	it("tells the investor the network wait is short and distinct from pricing", () => {
		renderModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending your request" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
		expect(screen.getByText(/pricing comes later/)).toBeTruthy()
		expect(screen.getByText(/will not cancel it/)).toBeTruthy()
	})

	it("shows the transaction hash as soon as the transaction is submitted", () => {
		renderModal({ status: "submitted", hash: "a".repeat(64) })

		expect(screen.getByText(/Transaction/)).toBeTruthy()
		expect(screen.getByText(/aaaa\.\.\.aaaa/)).toBeTruthy()
	})

	it("never shows a hash before the investor has signed anything", () => {
		renderModal({ status: "awaiting-signature" })

		expect(screen.queryByText(/Transaction/)).toBeNull()
	})

	it("shows the locked amount, batch and transaction hash once confirmed", () => {
		renderModal({ status: "confirmed", epochId: 7n, hash: "b".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Request locked in" }),
		).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
		expect(screen.getByText(/Batch 7/)).toBeTruthy()
		expect(screen.getByText(/next attestation/)).toBeTruthy()
		expect(screen.getByText(/bbbb\.\.\.bbbb/)).toBeTruthy()
	})

	it("never names the contract's epoch to the investor", () => {
		renderModal({ status: "confirmed", epochId: 7n, hash: "b".repeat(64) })

		expect(screen.queryByText(/Epoch/)).toBeNull()
	})

	it("gives only the confirmed moment the weight of an arrival, announced to assistive tech", () => {
		const confirmed = renderModal({
			status: "confirmed",
			epochId: 7n,
			hash: "b".repeat(64),
		})
		const arrival = screen.getByRole("status")
		expect(
			within(arrival).getByRole("heading", { name: "Request locked in" }),
		).toBeTruthy()
		confirmed.unmount()

		renderModal({ status: "submitted", hash: "a".repeat(64) })
		expect(screen.queryByRole("status")).toBeNull()
	})

	it("links the transaction hash to the explorer when one exists for this network", () => {
		explorerTransactionMock.mockReturnValueOnce(
			"https://stellar.expert/explorer/testnet/tx/aaaa",
		)
		renderModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("link", { name: /aaaa\.\.\.aaaa/ }).getAttribute("href"),
		).toBe("https://stellar.expert/explorer/testnet/tx/aaaa")
	})

	it("shows the hash as plain text rather than a dead link when there is no explorer", () => {
		explorerTransactionMock.mockReturnValueOnce(null)
		renderModal({ status: "submitted", hash: "a".repeat(64) })

		expect(screen.queryByRole("link")).toBeNull()
		expect(screen.getByText(/aaaa\.\.\.aaaa/)).toBeTruthy()
	})

	it.each<[string, RequestDepositStatus, string[]]>([
		[
			"preparing, before any signature is requested",
			{ status: "preparing" },
			["Approved in your wallet", "Sent to the network", "Recorded"],
		],
		[
			"awaiting a signature",
			{ status: "awaiting-signature" },
			[
				"Approved in your wallet, in progress",
				"Sent to the network",
				"Recorded",
			],
		],
		[
			"submitted",
			{ status: "submitted", hash: "a".repeat(64) },
			[
				"Approved in your wallet, done",
				"Sent to the network, in progress",
				"Recorded",
			],
		],
		[
			"confirmed",
			{ status: "confirmed", epochId: 7n },
			[
				"Approved in your wallet, done",
				"Sent to the network, done",
				"Recorded, done",
			],
		],
		[
			"declined",
			{ status: "failed", failure: { kind: "declined" } },
			["Approved in your wallet, failed", "Sent to the network", "Recorded"],
		],
		[
			"refused by the vault before any signature is asked for",
			{ status: "failed", failure: { kind: "contract-error", code: 6009 } },
			["Approved in your wallet, failed", "Sent to the network", "Recorded"],
		],
		[
			"an unknown outcome that reached the network",
			{ status: "failed", failure: { kind: "unknown" }, hash: "c".repeat(64) },
			[
				"Approved in your wallet, done",
				"Sent to the network, done",
				"Recorded, failed",
			],
		],
		[
			"an unknown outcome that never reached the network",
			{ status: "failed", failure: { kind: "unknown" } },
			[
				"Approved in your wallet, done",
				"Sent to the network, failed",
				"Recorded",
			],
		],
		[
			"interrupted before any signature was requested",
			{ status: "failed", failure: { kind: "interrupted" } },
			["Approved in your wallet, failed", "Sent to the network", "Recorded"],
		],
	])("shows the right step progress when %s", (_label, status, expected) => {
		renderModal(status)

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual(expected)
	})

	it("marks the approval step current while awaiting a signature", () => {
		renderModal({ status: "awaiting-signature" })

		expect(screen.getByRole("listitem", { current: "step" }).textContent).toBe(
			"Approved in your wallet, in progress",
		)
	})

	it("reads a declined signature as a choice, not a failure, and offers to try again", () => {
		const { onRetry } = renderModal({
			status: "failed",
			failure: { kind: "declined" },
		})

		expect(
			screen.getByRole("heading", { name: "You declined the request" }),
		).toBeTruthy()
		expect(screen.getByText(/chose not to sign/)).toBeTruthy()
		expect(screen.queryByText(/Transaction/)).toBeNull()

		fireEvent.click(screen.getByRole("button", { name: "Try again" }))
		expect(onRetry).toHaveBeenCalledTimes(1)
	})

	it("names the vault's own reason for a contract refusal, with no hash since it never reached the network", () => {
		renderModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6009 },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(
			screen.getByText(/already have a subscription request open/),
		).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
		expect(screen.queryByText(/Transaction/)).toBeNull()
	})

	it("falls back to the raw code for a contract refusal it does not recognize", () => {
		renderModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/reason 9999/)).toBeTruthy()
	})

	it("never tells an unknown outcome whether it went through", () => {
		renderModal({ status: "failed", failure: { kind: "unknown" } })

		expect(
			screen.getByRole("heading", { name: "Something went wrong" }),
		).toBeTruthy()
		expect(screen.getByText(/could not confirm/)).toBeTruthy()
		expect(screen.queryByText(/it did not/i)).toBeNull()
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
	})

	it("shows the hash for an unknown outcome that reached the network, so the investor can look it up themselves", () => {
		renderModal({
			status: "failed",
			failure: { kind: "unknown" },
			hash: "c".repeat(64),
		})

		expect(screen.getByText(/cccc\.\.\.cccc/)).toBeTruthy()
	})

	it("never implies a signature was requested when the failure happened before one was asked for", () => {
		renderModal({ status: "failed", failure: { kind: "interrupted" } })

		expect(
			screen.getByRole("heading", { name: "We couldn't reach the vault" }),
		).toBeTruthy()
		expect(
			screen.getByText(/Nothing was requested from your wallet/),
		).toBeTruthy()
		expect(screen.queryByText(/Transaction/)).toBeNull()
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderModal({ status: "awaiting-signature" })

		const dialog = screen.getByRole("dialog")
		expect(dialog.getAttribute("aria-modal")).toBe("true")

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it("dismisses on Escape without calling anything but onClose", () => {
		const { onClose, onRetry } = renderModal({ status: "submitted" })

		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })

		expect(onClose).toHaveBeenCalledTimes(1)
		expect(onRetry).not.toHaveBeenCalled()
	})
})

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

		expect(screen.getByText(/A price is available for this batch/)).toBeTruthy()
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

	it("names EpochNotFound as a batch that could not be found", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6029 },
		})

		expect(screen.getByText(/batch could not be found/)).toBeTruthy()
	})

	it("falls back to the raw code for a cancel refusal it does not recognize", () => {
		renderCancelModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/reason 9999/)).toBeTruthy()
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
				"This claims what your priced request is owed. If the price leaves no shares to claim, 150.00 USDC is returned to your wallet instead.",
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

	it("names RequestNotFound for a claim with no request in this batch", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6001 },
		})

		expect(screen.getByText(/no request to claim/)).toBeTruthy()
	})

	it("names EpochNotFound as a batch that could not be found", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6029 },
		})

		expect(screen.getByText(/batch could not be found/)).toBeTruthy()
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

	it("names the identity verifier's cross-contract refusal as no longer allowlisted, distinct from every other code", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/no longer allowlisted/)).toBeTruthy()
	})

	it("falls back to the raw code for a claim refusal it does not recognize", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/reason 9999/)).toBeTruthy()
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

	it("tells the investor their shares move into escrow, in share terms, without naming an epoch", () => {
		renderRedeemModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(screen.getByText(/100\.00 vUSDC/)).toBeTruthy()
		expect(screen.getByText(/into escrow/)).toBeTruthy()
		expect(screen.queryByText(/Epoch/)).toBeNull()
		expect(screen.queryByText(/epoch/)).toBeNull()
	})

	it("tells the investor the redemption request is on its way, distinct from subscribe copy", () => {
		renderRedeemModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending your redemption request" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("shows the escrowed shares, batch and transaction hash once confirmed", () => {
		renderRedeemModal({
			status: "confirmed",
			epochId: 9n,
			hash: "b".repeat(64),
		})

		expect(
			screen.getByRole("heading", { name: "Redemption request locked in" }),
		).toBeTruthy()
		expect(screen.getByText(/100\.00 vUSDC/)).toBeTruthy()
		expect(screen.getByText(/Batch 9/)).toBeTruthy()
		expect(screen.getByText(/next attestation/)).toBeTruthy()
		expect(screen.getByText(/bbbb\.\.\.bbbb/)).toBeTruthy()
	})

	it("names InvalidAmount for a non-positive share amount", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6007 },
		})

		expect(screen.getByText(/amount greater than zero/)).toBeTruthy()
	})

	it("names RequestOutstanding as a redemption already open in this batch, distinct from subscribe's wording", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6009 },
		})

		expect(
			screen.getByText(/already have a redemption request open/),
		).toBeTruthy()
	})

	it("names AmountTooLarge as the batch unable to hold this much", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6014 },
		})

		expect(screen.getByText(/too large for this batch to hold/)).toBeTruthy()
	})

	it("names EpochNotFound as a batch that could not be found", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6029 },
		})

		expect(screen.getByText(/batch could not be found/)).toBeTruthy()
	})

	it("names WindDownActive as the vault not accepting new redemptions", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6046 },
		})

		expect(screen.getByText(/not accepting new redemptions/)).toBeTruthy()
	})

	it("falls back to the raw code for a redeem refusal it does not recognize", () => {
		renderRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/reason 9999/)).toBeTruthy()
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

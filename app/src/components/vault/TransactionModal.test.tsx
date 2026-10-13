import { type Amount, type Price } from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { type AttestStatus } from "../../hooks/useAttest"
import { type CancelDepositStatus } from "../../hooks/useCancelDeposit"
import { type CancelRedeemStatus } from "../../hooks/useCancelRedeem"
import { type ClaimDepositStatus } from "../../hooks/useClaimDeposit"
import { type ClaimRedeemStatus } from "../../hooks/useClaimRedeem"
import { type CloseEpochStatus } from "../../hooks/useCloseEpoch"
import { type DeployToCustodianStatus } from "../../hooks/useDeployToCustodian"
import { type FulfillEpochStatus } from "../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../hooks/useFund"
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

const renderCancelRedeemModal = (status: CancelRedeemStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="cancel-redeem"
			status={status}
			amount="100.00"
			ticker="vUSDC"
			assetTicker="USDC"
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

const renderClaimRedeemModal = (status: ClaimRedeemStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="claim-redeem"
			status={status}
			amount="100.00"
			ticker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderCloseEpochModal = (status: CloseEpochStatus, epoch = "5") => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="close-epoch"
			status={status}
			epoch={epoch}
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderFulfillEpochModal = (status: FulfillEpochStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="fulfill-epoch"
			status={status}
			epoch="4"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderAttestModal = (
	status: AttestStatus,
	validFor: string | null = "1d",
) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="attest"
			status={status}
			price="1.0400"
			validFor={validFor}
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderDeployModal = (status: DeployToCustodianStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="deploy"
			status={status}
			amount="250.00"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderFundModal = (status: FundStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="fund"
			status={status}
			amount="100.00"
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
		expect(screen.getByText(/in escrow/)).toBeTruthy()
		expect(screen.getByText(/not today/)).toBeTruthy()
		expect(screen.queryByText(/batch/i)).toBeNull()
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

	it("shows the confirmed amount and transaction hash once confirmed", () => {
		renderModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Request submitted" }),
		).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
		expect(screen.queryByText(/Batch/)).toBeNull()
		expect(screen.getByText(/bbbb\.\.\.bbbb/)).toBeTruthy()
	})

	it("never mentions locking or attestation once confirmed", () => {
		renderModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(screen.queryByText(/locked/i)).toBeNull()
		expect(screen.queryByText(/attestation/i)).toBeNull()
	})

	it("never names the contract's epoch to the investor", () => {
		renderModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(screen.queryByText(/Epoch/)).toBeNull()
	})

	it("gives only the confirmed moment the weight of an arrival, announced to assistive tech", () => {
		const confirmed = renderModal({
			status: "confirmed",
			hash: "b".repeat(64),
		})
		const arrival = screen.getByRole("status")
		expect(
			within(arrival).getByRole("heading", { name: "Request submitted" }),
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
			{ status: "confirmed" },
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

	it("falls back to a generic refusal for a contract error it does not recognize, without the raw code", () => {
		renderModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(screen.getByText(/contact support/)).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
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

	it("dismisses on the cancel event the browser fires for the native Escape default action, without calling anything but onClose", () => {
		const { onClose, onRetry } = renderModal({ status: "submitted" })

		fireEvent(
			screen.getByRole("dialog"),
			new Event("cancel", { cancelable: true }),
		)

		expect(onClose).toHaveBeenCalledTimes(1)
		expect(onRetry).not.toHaveBeenCalled()
	})

	it("survives StrictMode's double-invoked mount effect without reopening an already open dialog", () => {
		const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, "showModal")

		expect(() =>
			render(
				<StrictMode>
					<TransactionModal
						action="subscribe"
						status={{ status: "preparing" }}
						amount="150.00"
						ticker="USDC"
						onClose={() => {}}
						onRetry={() => {}}
					/>
				</StrictMode>,
			),
		).not.toThrow()

		expect(showModalSpy).toHaveBeenCalledTimes(1)

		showModalSpy.mockRestore()
	})

	it("logs the contract error once, not again on every re-render of the same failure", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
		const status: RequestDepositStatus = {
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		}
		const { rerender } = renderModal(status)

		rerender(
			<TransactionModal
				action="subscribe"
				status={status}
				amount="150.00"
				ticker="USDC"
				onClose={() => {}}
				onRetry={() => {}}
			/>,
		)

		expect(consoleError).toHaveBeenCalledTimes(1)
		expect(consoleError).toHaveBeenCalledWith("Vault contract error 9999")

		consoleError.mockRestore()
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

	it("names a delisted controller as unable to receive its shares back, distinct from the claim wording for the same code", () => {
		renderCancelRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/shares cannot be returned/)).toBeTruthy()
		expect(screen.getByText(/claim the USDC/i)).toBeTruthy()
		expect(screen.queryByText(/cannot receive shares/)).toBeNull()
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

	it("names the identity verifier's cross-contract refusal as no longer allowlisted, distinct from every other code", () => {
		renderClaimModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/no longer allowlisted/)).toBeTruthy()
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
			hash: "b".repeat(64),
		})

		expect(screen.getByRole("heading", { name: "USDC claimed" })).toBeTruthy()
		expect(screen.getByText(/150\.00 USDC/)).toBeTruthy()
	})

	it("renders the claimed asset amount at full precision, not rounded to two fraction digits", () => {
		renderClaimRedeemModal({
			status: "confirmed",
			assetsClaimed: 952380952n as Amount,
			hash: "b".repeat(64),
		})

		expect(screen.getByText(/95\.2380952 USDC/)).toBeTruthy()
	})

	it("tells the investor their shares came back, not that an asset was claimed, on a zero result", () => {
		renderClaimRedeemModal({
			status: "confirmed",
			assetsClaimed: 0n as Amount,
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

	it("names a delisted controller as unable to receive the shares the zero-price branch tried to return, distinct from the claim and cancel-redeem wording for the same code", () => {
		renderClaimRedeemModal({
			status: "failed",
			failure: { kind: "contract-error", code: 304 },
		})

		expect(screen.getByText(/tried to return your shares instead/)).toBeTruthy()
		expect(
			screen.queryByText(
				/^Your address is no longer allowlisted, so it cannot receive shares\.$/,
			),
		).toBeNull()
		expect(screen.queryByText(/claim the USDC/i)).toBeNull()
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

describe("TransactionModal, closing an epoch", () => {
	it("opens with a preparing state naming the epoch being closed", () => {
		renderCloseEpochModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing to close epoch 5" }),
		).toBeTruthy()
	})

	it("tells the manager what signing seals and what it opens", () => {
		renderCloseEpochModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Signing seals epoch 5 and opens the next one. Requests in epoch 5 wait for a price.",
			),
		).toBeTruthy()
	})

	it.each(["", "unknown"])(
		"renders the signing prompt without throwing when the label is %j",
		(epoch) => {
			expect(() =>
				renderCloseEpochModal({ status: "awaiting-signature" }, epoch),
			).not.toThrow()
			expect(
				screen.getByRole("heading", { name: "Confirm in your wallet" }),
			).toBeTruthy()
		},
	)

	it("tells the manager the close is on its way", () => {
		renderCloseEpochModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending the close" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("names the epoch the vault sealed once confirmed, taking the id from the result rather than the label", () => {
		renderCloseEpochModal({
			status: "confirmed",
			sealedEpoch: 7n,
			hash: "b".repeat(64),
		})

		expect(screen.getByRole("heading", { name: "Epoch 7 sealed" })).toBeTruthy()
		expect(
			screen.getByText(
				"Epoch 8 is open and accepting requests. Epoch 7 prices once the notice elapses and a valid price is attested.",
			),
		).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[6046, /winding down/],
		[6029, /current epoch could not be found/],
		[6032, /not open/],
		[2000, /not authorized to close/],
		[2007, /does not hold the manager role/],
	])("names the vault's reason for code %i", (code, sentence) => {
		renderCloseEpochModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a close error it does not recognize, without the raw code", () => {
		renderCloseEpochModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6001 },
		})

		expect(
			screen.getByText(/The vault refused this request\. Try again/),
		).toBeTruthy()
		expect(screen.queryByText(/6001/)).toBeNull()
	})

	it("sends an unknown outcome to the Cycle card, not to the investor's requests", () => {
		renderCloseEpochModal({
			status: "failed",
			failure: { kind: "unknown" },
		})

		expect(
			screen.getByRole("heading", { name: "Something went wrong" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"We could not confirm whether this reached the network. We don't yet know if it went through, so check the Cycle card before trying again.",
			),
		).toBeTruthy()
		expect(screen.queryByText(/your requests/)).toBeNull()
	})

	it("reads a declined signature as a choice and offers to try again", () => {
		const { onRetry } = renderCloseEpochModal({
			status: "failed",
			failure: { kind: "declined" },
		})

		fireEvent.click(screen.getByRole("button", { name: "Try again" }))

		expect(onRetry).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, pricing an epoch", () => {
	it("opens with a preparing state naming the epoch being priced", () => {
		renderFulfillEpochModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing to price epoch 4" }),
		).toBeTruthy()
	})

	it("tells the operator what signing prices and settles", () => {
		renderFulfillEpochModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Signing prices epoch 4 at the oracle's current price and settles its requests.",
			),
		).toBeTruthy()
	})

	it("tells the operator the settlement is on its way", () => {
		renderFulfillEpochModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending the settlement" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("shows the share price the vault settled at once confirmed, to four places", () => {
		renderFulfillEpochModal({
			status: "confirmed",
			sharePrice: 1_250_000_000_000_000_000n as Price,
			hash: "b".repeat(64),
		})

		expect(screen.getByRole("heading", { name: "Epoch 4 priced" })).toBeTruthy()
		expect(
			screen.getByText(
				"Settled at 1.2500 per share. Share claims are ready; redemption claims wait until the reserve covers them.",
			),
		).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[6046, /winding down/],
		[6029, /epoch could not be found/],
		[6038, /not sealed/],
		[6042, /notice period has not elapsed/],
		[6044, /price is not valid/],
		[6043, /attested before this epoch was sealed/],
		[6031, /could not resolve a valid share price/],
		[6014, /too large/],
		[1000, /paused/],
	])("names the vault's reason for code %i", (code, sentence) => {
		renderFulfillEpochModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a settlement error it does not recognize, without the raw code", () => {
		renderFulfillEpochModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6035 },
		})

		expect(
			screen.getByText(/The vault refused this request\. Try again/),
		).toBeTruthy()
		expect(screen.queryByText(/6035/)).toBeNull()
	})

	it("sends an unknown outcome to the Cycle card, not to the investor's requests", () => {
		renderFulfillEpochModal({
			status: "failed",
			failure: { kind: "unknown" },
			hash: "c".repeat(64),
		})

		expect(
			screen.getByText(/check the Cycle card before trying again/),
		).toBeTruthy()
		expect(screen.queryByText(/your requests/)).toBeNull()
		expect(screen.getByText(/cccc\.\.\.cccc/)).toBeTruthy()
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderFulfillEpochModal({ status: "preparing" })

		expect(screen.getByRole("dialog")).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, attesting a price", () => {
	it("opens with a preparing state naming the price being attested", () => {
		renderAttestModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing to attest 1.0400" }),
		).toBeTruthy()
	})

	it("tells the attester what signing records", () => {
		renderAttestModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Signing records 1.0400 as the share price. Sealed epochs settle at it once their notice elapses.",
			),
		).toBeTruthy()
	})

	it("tells the attester the attestation is on its way", () => {
		renderAttestModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending the attestation" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("says how long the price stays valid once confirmed", () => {
		renderAttestModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(screen.getByRole("heading", { name: "Price attested" })).toBeTruthy()
		expect(
			screen.getByText("1.0400 is the share price. Valid for 1d."),
		).toBeTruthy()
	})

	it("leaves the validity out when the freshness window is not known", () => {
		renderAttestModal({ status: "confirmed" }, null)

		expect(screen.getByText("1.0400 is the share price.")).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[3002, /outside the band/],
		[3005, /already have expired/],
		[3003, /cooldown .* has not elapsed/],
		[3004, /moves further from the last attested price/],
	])("names the oracle's reason for code %i", (code, sentence) => {
		renderAttestModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it.each([2000, 2007])(
		"falls back to a generic refusal for code %i, without the raw code",
		(code) => {
			renderAttestModal({
				status: "failed",
				failure: { kind: "contract-error", code },
			})

			expect(
				screen.getByText(/The vault refused this request\. Try again/),
			).toBeTruthy()
			expect(screen.queryByText(new RegExp(String(code)))).toBeNull()
		},
	)

	it("sends an unknown outcome to the Cycle card, not to the investor's requests", () => {
		renderAttestModal({ status: "failed", failure: { kind: "unknown" } })

		expect(
			screen.getByText(/check the Cycle card before trying again/),
		).toBeTruthy()
		expect(screen.queryByText(/your requests/)).toBeNull()
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderAttestModal({ status: "preparing" })

		expect(screen.getByRole("dialog")).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, deploying to the custodian", () => {
	it("opens with a preparing state naming the amount being deployed", () => {
		renderDeployModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing to deploy 250.00" }),
		).toBeTruthy()
	})

	it("tells the treasury what signing sends and where", () => {
		renderDeployModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Signing sends 250.00 from the vault's reserve to the custodian.",
			),
		).toBeTruthy()
	})

	it("tells the treasury the deployment is on its way", () => {
		renderDeployModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending the deployment" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("says what left the vault once confirmed", () => {
		renderDeployModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(screen.getByRole("heading", { name: "Deployed" })).toBeTruthy()
		expect(
			screen.getByText("250.00 left the vault for the custodian."),
		).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[6046, /winding down/],
		[6007, /greater than zero/],
		[6012, /No custodian is set/],
		[6005, /free reserve/],
		[6014, /too large/],
		[2000, /not authorized/],
		[2007, /treasury role/],
	])("names the vault's reason for code %i", (code, sentence) => {
		renderDeployModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a code it does not recognize, without the raw code", () => {
		renderDeployModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6029 },
		})

		expect(
			screen.getByText(/The vault refused this request\. Try again/),
		).toBeTruthy()
		expect(screen.queryByText(/6029/)).toBeNull()
	})

	it("sends an unknown outcome to the Cycle card, not to the investor's requests", () => {
		renderDeployModal({ status: "failed", failure: { kind: "unknown" } })

		expect(
			screen.getByText(/check the Cycle card before trying again/),
		).toBeTruthy()
		expect(screen.queryByText(/your requests/)).toBeNull()
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderDeployModal({ status: "preparing" })

		expect(screen.getByRole("dialog")).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe("TransactionModal, funding the reserve", () => {
	it("opens with a preparing state naming the amount being funded", () => {
		renderFundModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing to fund 100.00" }),
		).toBeTruthy()
	})

	it("tells the funder what signing moves out of their wallet", () => {
		renderFundModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Signing moves 100.00 from your wallet into the vault's reserve.",
			),
		).toBeTruthy()
	})

	it("tells the funder the funding is on its way", () => {
		renderFundModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending the funding" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("says what joined the reserve once confirmed", () => {
		renderFundModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(screen.getByRole("heading", { name: "Funded" })).toBeTruthy()
		expect(screen.getByText("100.00 joined the reserve.")).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[6007, /greater than zero/],
		[6014, /too large/],
	])("names the vault's reason for code %i", (code, sentence) => {
		renderFundModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("points the funder at their balance and trustline when the asset transfer refuses, without the raw code", () => {
		renderFundModal({
			status: "failed",
			failure: { kind: "contract-error", code: 10 },
		})

		expect(
			screen.getByText(
				"Your wallet could not cover the transfer. Check the balance and the trustline.",
			),
		).toBeTruthy()
		expect(screen.queryByText(/\b10\b/)).toBeNull()
	})

	it("sends an unknown outcome to the Cycle card, not to the investor's requests", () => {
		renderFundModal({ status: "failed", failure: { kind: "unknown" } })

		expect(
			screen.getByText(/check the Cycle card before trying again/),
		).toBeTruthy()
		expect(screen.queryByText(/your requests/)).toBeNull()
	})

	it("is reachable as a dialog and dismissible by its close control", () => {
		const { onClose } = renderFundModal({ status: "preparing" })

		expect(screen.getByRole("dialog")).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

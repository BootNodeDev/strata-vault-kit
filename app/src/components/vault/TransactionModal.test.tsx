import {
	type Amount,
	formatDate,
	type Price,
	type SubmitFailure,
} from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { type ActivateWindDownStatus } from "../../hooks/useActivateWindDown"
import { type AttestStatus } from "../../hooks/useAttest"
import { type CancelDepositStatus } from "../../hooks/useCancelDeposit"
import { type CancelRedeemStatus } from "../../hooks/useCancelRedeem"
import { type ClaimDepositStatus } from "../../hooks/useClaimDeposit"
import { type ClaimRedeemStatus } from "../../hooks/useClaimRedeem"
import { type ClaimWindDownStatus } from "../../hooks/useClaimWindDown"
import { type CloseEpochStatus } from "../../hooks/useCloseEpoch"
import { type TransactionStatus } from "../../hooks/useContractTransaction"
import { type DeployToCustodianStatus } from "../../hooks/useDeployToCustodian"
import { type FinalizeWindDownRoundStatus } from "../../hooks/useFinalizeWindDownRound"
import { type FulfillEpochStatus } from "../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../hooks/useFund"
import { type RequestDepositStatus } from "../../hooks/useRequestDeposit"
import { type RequestRedeemStatus } from "../../hooks/useRequestRedeem"
import TransactionModal, {
	type ComplianceModalAction,
	type ConfigurationModalAction,
	type EmergencyModalAction,
	type GovernanceModalAction,
} from "./TransactionModal"

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

const renderActivateModal = (status: ActivateWindDownStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="activate-wind-down"
			status={status}
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

const renderFinalizeModal = (status: FinalizeWindDownRoundStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<TransactionModal
			action="finalize-round"
			status={status}
			round="3"
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

	it("tells apart a wallet that failed to sign from a declined request", () => {
		const { onRetry } = renderModal({
			status: "failed",
			failure: { kind: "unsigned" },
		})

		expect(
			screen.getByRole("heading", { name: "The wallet did not sign" }),
		).toBeTruthy()
		expect(
			screen.getByText("Nothing was sent. Try again when you're ready."),
		).toBeTruthy()
		expect(screen.queryByText(/chose not to sign/)).toBeNull()

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

	it("names SetupOpen as deposits starting once setup closes", () => {
		renderModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6064 },
		})

		expect(screen.getByText(/setup is still open/)).toBeTruthy()
		expect(screen.getByText(/once it closes/)).toBeTruthy()
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
		expect(consoleError).toHaveBeenCalledWith("Contract error 9999")

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
				"Signing records 1.0400 as the share price, with its proof. Sealed epochs settle at it once their notice elapses.",
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
		[3010, /^Unpause the NAV first\.$/],
		[3023, /^The proof hash cannot be all zeros\.$/],
		[3024, /^The proof URI is longer than 256 bytes\.$/],
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

describe("TransactionModal, activating the wind-down", () => {
	it("opens with a preparing state", () => {
		renderActivateModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", {
				name: "Preparing to activate the wind-down",
			}),
		).toBeTruthy()
	})

	it("tells the signer what the activation stops and opens", () => {
		renderActivateModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Signing stops new requests and opens distribution rounds.",
			),
		).toBeTruthy()
	})

	it("tells the signer the activation is on its way", () => {
		renderActivateModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending the activation" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("says requests are closed and rounds can distribute once confirmed", () => {
		renderActivateModal({ status: "confirmed", hash: "b".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Wind-down active" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"New requests are closed. Rounds can now distribute the free reserve.",
			),
		).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[6047, /No wind-down has been proposed/],
		[6046, /already active/],
		[6049, /delay has not elapsed/],
	])("names the vault's reason for code %i", (code, sentence) => {
		renderActivateModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a code it does not recognize, without the raw code", () => {
		renderActivateModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6050 },
		})

		expect(
			screen.getByText(/The vault refused this request\. Try again/),
		).toBeTruthy()
		expect(screen.queryByText(/6050/)).toBeNull()
	})

	it("sends an unknown outcome to the Cycle card, not to the investor's requests", () => {
		renderActivateModal({ status: "failed", failure: { kind: "unknown" } })

		expect(
			screen.getByText(/check the Cycle card before trying again/),
		).toBeTruthy()
		expect(screen.queryByText(/your requests/)).toBeNull()
	})
})

describe("TransactionModal, finalizing a wind-down round", () => {
	it("opens with a preparing state naming the round", () => {
		renderFinalizeModal({ status: "preparing" })

		expect(
			screen.getByRole("heading", { name: "Preparing round 3" }),
		).toBeTruthy()
	})

	it("tells the signer what the round distributes", () => {
		renderFinalizeModal({ status: "awaiting-signature" })

		expect(
			screen.getByRole("heading", { name: "Confirm in your wallet" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Signing distributes the free reserve to holders as round 3.",
			),
		).toBeTruthy()
	})

	it("tells the signer the round is on its way", () => {
		renderFinalizeModal({ status: "submitted", hash: "a".repeat(64) })

		expect(
			screen.getByRole("heading", { name: "Sending the round" }),
		).toBeTruthy()
		expect(screen.getByText(/on its way to the network/)).toBeTruthy()
	})

	it("says what holders can claim once confirmed, to the last digit", () => {
		renderFinalizeModal({
			status: "confirmed",
			hash: "b".repeat(64),
			credited: 9_000_000_001n as Amount,
		})

		expect(
			screen.getByRole("heading", { name: "Round 3 finalized" }),
		).toBeTruthy()
		expect(
			screen.getByText("900.0000001 is claimable by holders."),
		).toBeTruthy()
	})

	it.each<[number, RegExp]>([
		[6050, /not active/],
		[6052, /nothing to distribute/],
		[6014, /too large/],
	])("names the vault's reason for code %i", (code, sentence) => {
		renderFinalizeModal({
			status: "failed",
			failure: { kind: "contract-error", code },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("sends an unknown outcome to the Cycle card, not to the investor's requests", () => {
		renderFinalizeModal({ status: "failed", failure: { kind: "unknown" } })

		expect(
			screen.getByText(/check the Cycle card before trying again/),
		).toBeTruthy()
		expect(screen.queryByText(/your requests/)).toBeNull()
	})
})

const renderEmergencyModal = (
	action: EmergencyModalAction,
	status: TransactionStatus,
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

describe("TransactionModal, emergency actions", () => {
	it("shows the signatures collected, the expiry and the signing link to copy", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})
		const expiresAt = new Date(Date.UTC(2026, 9, 22))
		renderEmergencyModal("pause-vault", {
			status: "shared",
			xdr: "AAAAXDR",
			standing: { needs: 2 },
			expiresAt,
		})
		const link = `${window.location.origin}/sign#AAAAXDR`

		expect(
			screen.getByRole("heading", { name: "1 of 2 signatures" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				`Share the link with the next signer. Valid until ${formatDate(BigInt(expiresAt.getTime() / 1000))}.`,
			),
		).toBeTruthy()
		expect(
			screen.getByRole<HTMLInputElement>("textbox", { name: "Signing link" })
				.value,
		).toBe(link)
		expect(screen.getByText("Approved in your wallet").textContent).toMatch(
			/done/,
		)

		fireEvent.click(screen.getByRole("button", { name: "Copy link" }))

		expect(writeText).toHaveBeenCalledWith(link)
		expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
	})

	it("names the weight a weighted signer adds against the threshold", () => {
		renderEmergencyModal("pause-vault", {
			status: "shared",
			xdr: "AAAAXDR",
			standing: { weight: 1, threshold: 3 },
			expiresAt: null,
		})

		expect(
			screen.getByRole("heading", { name: "weight 1 of threshold 3" }),
		).toBeTruthy()
	})

	it("keeps offering the copy when the clipboard refuses, leaving the link to select", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"))
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})
		renderEmergencyModal("pause-vault", {
			status: "shared",
			xdr: "AAAAXDR",
			standing: { needs: 2 },
			expiresAt: null,
		})

		fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
		await act(() => Promise.resolve())

		expect(writeText).toHaveBeenCalledTimes(1)
		expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Copied" })).toBeNull()
	})

	it.each<[SubmitFailure, string]>([
		["expired", "The transaction expired before it was submitted."],
		[
			"sequence-consumed",
			"The account moved on; this transaction is no longer valid.",
		],
		["bad-auth", "The signatures do not match the account's threshold."],
		["fee", "The account cannot pay the fee."],
		["fee-too-low", "The fee is below the network minimum. Propose it again."],
		["not-accepted", "The network did not accept it. Try again."],
	])("explains a %s rejection from the network", (reason, sentence) => {
		renderEmergencyModal("pause-vault", {
			status: "failed",
			failure: { kind: "network", reason },
			hash: "d".repeat(64),
		})

		expect(
			screen.getByRole("heading", { name: "The network rejected it" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
		expect(screen.getByText("Sent to the network").textContent).toMatch(
			/failed/,
		)
	})

	it("asks to try again when a prepared transaction went stale", () => {
		const { onRetry } = renderModal({
			status: "failed",
			failure: { kind: "stale" },
		})

		expect(
			screen.getByRole("heading", { name: "The transaction went stale" }),
		).toBeTruthy()
		expect(
			screen.getByText(
				"The account moved on since it was prepared, so nothing was sent. Try again.",
			),
		).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Try again" }))
		expect(onRetry).toHaveBeenCalledTimes(1)
	})

	it("treats an unexplained network rejection as an unknown outcome", () => {
		renderEmergencyModal("pause-vault", {
			status: "failed",
			failure: { kind: "network", reason: "unknown" },
		})

		expect(
			screen.getByRole("heading", { name: "Something went wrong" }),
		).toBeTruthy()
		expect(
			screen.getByText(/check the Emergency tab before trying again/),
		).toBeTruthy()
	})

	it.each<[EmergencyModalAction, string, string]>([
		["pause-vault", "Preparing to pause the vault", "Vault paused"],
		["unpause-vault", "Preparing to unpause the vault", "Vault unpaused"],
		["pause-nav", "Preparing to pause the NAV", "NAV paused"],
		["unpause-nav", "Preparing to unpause the NAV", "NAV unpaused"],
		[
			"clear-latest",
			"Preparing to clear the latest price",
			"Latest price cleared",
		],
		["pause-token", "Preparing to pause the share token", "Share token paused"],
		[
			"unpause-token",
			"Preparing to unpause the share token",
			"Share token unpaused",
		],
	])("walks %s from preparing to confirmed", (action, preparing, confirmed) => {
		const { rerender } = renderEmergencyModal(action, { status: "preparing" })
		expect(screen.getByRole("heading", { name: preparing })).toBeTruthy()

		rerender(
			<TransactionModal
				action={action}
				status={{ status: "confirmed", hash: "b".repeat(64) }}
				onClose={vi.fn()}
				onRetry={vi.fn()}
			/>,
		)
		expect(screen.getByRole("heading", { name: confirmed })).toBeTruthy()
	})

	it("tells the signer what pausing the vault stops and what stays open", () => {
		renderEmergencyModal("pause-vault", { status: "awaiting-signature" })

		expect(
			screen.getByText("Signing stops new deposits, pricing and upgrades."),
		).toBeTruthy()
	})

	it.each<[EmergencyModalAction, string, string]>([
		[
			"pause-token",
			"Signing stops holder transfers only.",
			"Holder transfers are stopped. Minting, burning, the vault's escrow moves and legal transfers continue.",
		],
		[
			"unpause-token",
			"Signing resumes holder transfers.",
			"Holder transfers are open again.",
		],
	])(
		"words %s after what the share token enforces",
		(action, signing, done) => {
			const { rerender } = renderEmergencyModal(action, {
				status: "awaiting-signature",
			})
			expect(screen.getByText(signing)).toBeTruthy()

			rerender(
				<TransactionModal
					action={action}
					status={{ status: "confirmed" }}
					onClose={vi.fn()}
					onRetry={vi.fn()}
				/>,
			)
			expect(screen.getByText(done)).toBeTruthy()
		},
	)

	it.each<[EmergencyModalAction, number, string, RegExp]>([
		["pause-vault", 1000, "vault", /The vault is already paused/],
		["unpause-vault", 1001, "vault", /The vault is not paused/],
		["pause-token", 1000, "share token", /The share token is already paused/],
		["unpause-token", 1001, "share token", /The share token is not paused/],
		["pause-nav", 2000, "oracle", /does not hold the role/],
		["clear-latest", 3008, "oracle", /The NAV is not paused/],
	])(
		"names the reason %s was refused with code %i",
		(action, code, refuser, sentence) => {
			renderEmergencyModal(action, {
				status: "failed",
				failure: { kind: "contract-error", code },
			})

			expect(
				screen.getByRole("heading", {
					name: `The ${refuser} refused this request`,
				}),
			).toBeTruthy()
			expect(screen.getByText(sentence)).toBeTruthy()
		},
	)

	it("falls back to a generic refusal from the right contract without the raw code", () => {
		renderEmergencyModal("pause-token", {
			status: "failed",
			failure: { kind: "contract-error", code: 9999 },
		})

		expect(
			screen.getByText(/The share token refused this request\. Try again/),
		).toBeTruthy()
		expect(screen.queryByText(/9999/)).toBeNull()
	})

	it("sends an unknown outcome to the Emergency tab", () => {
		renderEmergencyModal("pause-nav", {
			status: "failed",
			failure: { kind: "unknown" },
		})

		expect(
			screen.getByText(/check the Emergency tab before trying again/),
		).toBeTruthy()
	})
})

const renderConfigurationModal = (
	action: ConfigurationModalAction,
	status: TransactionStatus,
	value = "",
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			value={value}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

describe("TransactionModal, configuration actions", () => {
	it.each<[ConfigurationModalAction, string, string]>([
		[
			"set-deposit-cap",
			"Preparing to set the deposit cap",
			"Deposit cap updated",
		],
		["set-custodian", "Preparing to set the custodian", "Custodian updated"],
		["set-notice", "Preparing to set the notice", "Notice updated"],
		[
			"set-wind-down-delay",
			"Preparing to set the wind-down delay",
			"Wind-down delay updated",
		],
		[
			"set-oracle-config",
			"Preparing to set the oracle limits",
			"Oracle limits updated",
		],
		[
			"set-compliance",
			"Preparing to set the compliance contract",
			"Compliance contract updated",
		],
		[
			"set-identity-verifier",
			"Preparing to set the identity verifier",
			"Identity verifier updated",
		],
	])("walks %s from preparing to confirmed", (action, preparing, confirmed) => {
		const { rerender } = renderConfigurationModal(action, {
			status: "preparing",
		})
		expect(screen.getByRole("heading", { name: preparing })).toBeTruthy()

		rerender(
			<TransactionModal
				action={action}
				status={{ status: "confirmed" }}
				value="3d"
				onClose={vi.fn()}
				onRetry={vi.fn()}
			/>,
		)
		expect(screen.getByRole("heading", { name: confirmed })).toBeTruthy()
	})

	it("states the new value before signing and once recorded", () => {
		const { rerender } = renderConfigurationModal(
			"set-deposit-cap",
			{ status: "awaiting-signature" },
			"5,000.00",
		)
		expect(screen.getByText("New deposit cap: 5,000.00.")).toBeTruthy()

		rerender(
			<TransactionModal
				action="set-deposit-cap"
				status={{ status: "confirmed" }}
				value="5,000.00"
				onClose={vi.fn()}
				onRetry={vi.fn()}
			/>,
		)
		expect(screen.getByText("Deposit cap: 5,000.00.")).toBeTruthy()
	})

	it.each<[ConfigurationModalAction, string]>([
		["set-custodian", "Treasury deploys to the new address from now on."],
		["set-notice", "Applies to epochs closed from now on."],
		["set-wind-down-delay", "A proposed wind-down keeps its activation time."],
	])("names the side effect of %s once recorded", (action, effect) => {
		renderConfigurationModal(action, { status: "confirmed" }, "3d")

		expect(screen.getByText(effect)).toBeTruthy()
	})

	it.each<[ConfigurationModalAction, string, string, string, string]>([
		[
			"propose-custodian",
			"GABC...WXYZ",
			"Preparing to propose a custodian",
			"Signing queues custodian GABC...WXYZ.",
			"Custodian GABC...WXYZ applies once the upgrade delay passes.",
		],
		[
			"propose-notice",
			"12h",
			"Preparing to propose a notice",
			"Signing queues notice 12h.",
			"Notice 12h applies once the upgrade delay passes.",
		],
		[
			"propose-wind-down-delay",
			"8d",
			"Preparing to propose a wind-down delay",
			"Signing queues wind-down delay 8d.",
			"Wind-down delay 8d applies once the upgrade delay passes.",
		],
		[
			"propose-compliance",
			"CABC...WXYZ",
			"Preparing to propose a compliance contract",
			"Signing queues compliance contract CABC...WXYZ.",
			"Compliance contract CABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"propose-identity-verifier",
			"CABC...WXYZ",
			"Preparing to propose an identity verifier",
			"Signing queues identity verifier CABC...WXYZ.",
			"Identity verifier CABC...WXYZ applies once the vault's upgrade delay passes.",
		],
	])(
		"walks %s from preparing to proposed",
		(action, value, preparing, signing, doneBody) => {
			const { rerender } = renderConfigurationModal(
				action,
				{ status: "preparing" },
				value,
			)
			expect(screen.getByRole("heading", { name: preparing })).toBeTruthy()

			rerender(
				<TransactionModal
					action={action}
					status={{ status: "awaiting-signature" }}
					value={value}
					onClose={vi.fn()}
					onRetry={vi.fn()}
				/>,
			)
			expect(screen.getByText(signing)).toBeTruthy()

			rerender(
				<TransactionModal
					action={action}
					status={{ status: "confirmed" }}
					value={value}
					onClose={vi.fn()}
					onRetry={vi.fn()}
				/>,
			)
			expect(
				screen.getByRole("heading", { name: "Change proposed" }),
			).toBeTruthy()
			expect(screen.getByText(doneBody)).toBeTruthy()
		},
	)

	it.each<[ConfigurationModalAction, number, string, RegExp]>([
		["set-deposit-cap", 6007, "vault", /The deposit cap cannot be negative/],
		["set-notice", 6045, "vault", /The notice cannot exceed 30 days/],
		["set-notice", 6061, "vault", /The notice cannot exceed the upgrade delay/],
		[
			"set-wind-down-delay",
			6053,
			"vault",
			/The wind-down delay cannot exceed 90 days/,
		],
		[
			"set-wind-down-delay",
			6069,
			"vault",
			/The wind-down delay cannot be under 7 days/,
		],
		["propose-custodian", 6075, "vault", /custodian cannot be the vault/],
		["propose-notice", 6064, "vault", /Setup is still open/],
		["set-notice", 6065, "vault", /goes through the timelock/],
		["propose-custodian", 6063, "vault", /16 pending changes/],
		[
			"set-oracle-config",
			3001,
			"oracle",
			/One of the oracle limits is out of range/,
		],
		["set-compliance", 2000, "share token", /does not hold the role/],
		["propose-compliance", 7003, "share token", /16 pending changes/],
		["propose-identity-verifier", 7004, "share token", /Setup is still open/],
		["set-compliance", 7005, "share token", /goes through the timelock/],
		["propose-compliance", 7008, "share token", /vault is winding down/],
	])(
		"names the reason %s was refused with code %i",
		(action, code, refuser, sentence) => {
			renderConfigurationModal(action, {
				status: "failed",
				failure: { kind: "contract-error", code },
			})

			expect(
				screen.getByRole("heading", {
					name: `The ${refuser} refused this request`,
				}),
			).toBeTruthy()
			expect(screen.getByText(sentence)).toBeTruthy()
		},
	)

	it("sends an unknown outcome to the Configuration tab", () => {
		renderConfigurationModal("set-notice", {
			status: "failed",
			failure: { kind: "unknown" },
		})

		expect(
			screen.getByText(/check the Configuration tab before trying again/),
		).toBeTruthy()
	})
})

const renderGovernanceModal = (
	action: GovernanceModalAction,
	status: TransactionStatus,
	value = "Manager to GABC...WXYZ",
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			value={value}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

describe("TransactionModal, governance actions", () => {
	it.each<[GovernanceModalAction, string, string, string, string]>([
		[
			"grant-vault-role",
			"Manager to GABC...WXYZ",
			"Signing grants Manager to GABC...WXYZ.",
			"Role granted",
			"Granted Manager to GABC...WXYZ.",
		],
		[
			"revoke-token-role",
			"Manager from CVAU...LTID",
			"Signing revokes Manager from CVAU...LTID.",
			"Role revoked",
			"Revoked Manager from CVAU...LTID.",
		],
	])(
		"names the role change of %s",
		(action, value, signing, done, doneBody) => {
			const { unmount } = renderGovernanceModal(
				action,
				{ status: "awaiting-signature" },
				value,
			)
			expect(screen.getByText(signing)).toBeTruthy()
			unmount()

			renderGovernanceModal(action, { status: "confirmed" }, value)
			expect(screen.getByRole("heading", { name: done })).toBeTruthy()
			expect(screen.getByText(doneBody)).toBeTruthy()
		},
	)

	it.each<[GovernanceModalAction, number, string, RegExp]>([
		["grant-vault-role", 2000, "vault", /does not hold the role/],
		["revoke-oracle-role", 2002, "oracle", /holders changed/],
		["revoke-token-role", 2007, "share token", /does not hold this role/],
		[
			"grant-oracle-role",
			2010,
			"oracle",
			/The oracle already has the maximum number of roles/,
		],
		["cancel-vault-handover", 2200, "vault", /no pending handover/],
		["hand-over-oracle-admin", 2201, "oracle", /expiry is outside/],
		["cancel-token-handover", 2202, "share token", /different address/],
		["accept-vault-admin", 2203, "vault", /expired before it was accepted/],
		["apply-change", 1000, "vault", /The vault is paused/],
		["apply-change", 6046, "vault", /winding down/],
		["propose-wind-down", 6046, "vault", /wind-down is already active/],
		["cancel-wind-down", 6047, "vault", /No wind-down is proposed/],
		["propose-wind-down", 6048, "vault", /wind-down is already proposed/],
		["propose-code-upgrade", 6055, "vault", /code change is already pending/],
		["cancel-change", 6056, "vault", /no pending change with that id/],
		["apply-change", 6057, "vault", /delay has not passed yet/],
		["propose-grant-role", 6063, "vault", /16 pending changes/],
		["propose-admin", 6064, "vault", /Setup is still open/],
		["grant-vault-role", 6065, "vault", /goes through the timelock/],
		["propose-upgrade-delay", 6058, "vault", /cannot be under 7 days/],
		["propose-upgrade-delay", 6059, "vault", /cannot be under the notice/],
		["propose-upgrade-delay", 6060, "vault", /cannot exceed 90 days/],
		[
			"cancel-token-change",
			7001,
			"share token",
			/no pending change with that id/,
		],
		["apply-token-change", 7002, "share token", /delay has not passed yet/],
		["propose-token-grant-role", 7003, "share token", /16 pending changes/],
		["propose-token-admin", 7004, "share token", /Setup is still open/],
		["grant-token-role", 7005, "share token", /goes through the timelock/],
		["apply-token-change", 7008, "share token", /vault is winding down/],
		["apply-token-change", 7009, "share token", /vault is paused/],
		["apply-token-change", 7011, "share token", /upgrade is already pending/],
		[
			"hand-over-token-admin",
			7016,
			"share token",
			/hand-over is still pending/,
		],
	])(
		"names the reason %s was refused with code %i",
		(action, code, refuser, sentence) => {
			renderGovernanceModal(action, {
				status: "failed",
				failure: { kind: "contract-error", code },
			})

			expect(
				screen.getByRole("heading", {
					name: `The ${refuser} refused this request`,
				}),
			).toBeTruthy()
			expect(screen.getByText(sentence)).toBeTruthy()
		},
	)

	it.each<[GovernanceModalAction, string, string, string, string]>([
		[
			"hand-over-vault-admin",
			"GABC...WXYZ becomes admin once it accepts before 21 Nov, 22:13 UTC.",
			"Signing proposes the handover.",
			"Handover proposed",
			"GABC...WXYZ becomes admin once it accepts before 21 Nov, 22:13 UTC.",
		],
		[
			"cancel-oracle-handover",
			"GABC...WXYZ",
			"Signing withdraws the offer to GABC...WXYZ.",
			"Handover cancelled",
			"GABC...WXYZ can no longer accept.",
		],
		[
			"accept-token-admin",
			"share token",
			"Signing makes this wallet the share token admin.",
			"Admin accepted",
			"This wallet is now the share token admin.",
		],
	])(
		"names the handover step of %s",
		(action, value, signing, done, doneBody) => {
			const { unmount } = renderGovernanceModal(
				action,
				{ status: "awaiting-signature" },
				value,
			)
			expect(screen.getByText(signing)).toBeTruthy()
			unmount()

			renderGovernanceModal(action, { status: "confirmed" }, value)
			expect(screen.getByRole("heading", { name: done })).toBeTruthy()
			expect(screen.getByText(doneBody)).toBeTruthy()
		},
	)

	it.each<[GovernanceModalAction, string, string, string, string]>([
		[
			"propose-code-upgrade",
			"Code abab...abab",
			"Signing queues Code abab...abab.",
			"Upgrade proposed",
			"Code abab...abab can apply once the upgrade delay passes.",
		],
		[
			"apply-change",
			"vault change #3: Upgrade delay 14d",
			"Signing applies vault change #3: Upgrade delay 14d.",
			"Change applied",
			"Applied vault change #3: Upgrade delay 14d.",
		],
		[
			"cancel-change",
			"vault change #2: Code upgrade abab...abab",
			"Signing withdraws vault change #2: Code upgrade abab...abab.",
			"Change cancelled",
			"Withdrew vault change #2: Code upgrade abab...abab.",
		],
		[
			"propose-grant-role",
			"Manager to GABC...WXYZ",
			"Signing queues the grant of Manager to GABC...WXYZ.",
			"Change proposed",
			"The grant of Manager to GABC...WXYZ applies once the upgrade delay passes.",
		],
		[
			"propose-revoke-role",
			"Manager from GABC...WXYZ",
			"Signing queues the revoke of Manager from GABC...WXYZ.",
			"Change proposed",
			"The revoke of Manager from GABC...WXYZ applies once the upgrade delay passes.",
		],
		[
			"propose-admin",
			"GABC...WXYZ",
			"Signing queues the hand-over to GABC...WXYZ.",
			"Change proposed",
			"The hand-over to GABC...WXYZ applies once the upgrade delay passes.",
		],
		[
			"propose-token-grant-role",
			"Manager to GABC...WXYZ",
			"Signing queues the grant of Manager to GABC...WXYZ.",
			"Change proposed",
			"The grant of Manager to GABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"propose-token-revoke-role",
			"Manager from GABC...WXYZ",
			"Signing queues the revoke of Manager from GABC...WXYZ.",
			"Change proposed",
			"The revoke of Manager from GABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"propose-token-admin",
			"GABC...WXYZ",
			"Signing queues the hand-over to GABC...WXYZ.",
			"Change proposed",
			"The hand-over to GABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"apply-token-change",
			"share token change #1: Compliance contract CABC...WXYZ",
			"Signing applies share token change #1: Compliance contract CABC...WXYZ.",
			"Change applied",
			"Applied share token change #1: Compliance contract CABC...WXYZ.",
		],
		[
			"cancel-token-change",
			"share token change #1: Compliance contract CABC...WXYZ",
			"Signing withdraws share token change #1: Compliance contract CABC...WXYZ.",
			"Change cancelled",
			"Withdrew share token change #1: Compliance contract CABC...WXYZ.",
		],
		[
			"propose-wind-down",
			"Activates 21 Nov, 22:13 UTC.",
			"Signing starts the wind-down countdown.",
			"Wind-down proposed",
			"Activates 21 Nov, 22:13 UTC.",
		],
		[
			"cancel-wind-down",
			"",
			"Signing withdraws the wind-down.",
			"Wind-down cancelled",
			"The vault stays open.",
		],
	])(
		"names the timelock step of %s",
		(action, value, signing, done, doneBody) => {
			const { unmount } = renderGovernanceModal(
				action,
				{ status: "awaiting-signature" },
				value,
			)
			expect(screen.getByText(signing)).toBeTruthy()
			unmount()

			renderGovernanceModal(action, { status: "confirmed" }, value)
			expect(screen.getByRole("heading", { name: done })).toBeTruthy()
			expect(screen.getByText(doneBody)).toBeTruthy()
		},
	)

	it("sends an unknown outcome to the Governance tab", () => {
		renderGovernanceModal("grant-token-role", {
			status: "failed",
			failure: { kind: "unknown" },
		})

		expect(
			screen.getByText(/check the Governance tab before trying again/),
		).toBeTruthy()
	})
})

const renderComplianceModal = (
	action: ComplianceModalAction,
	status: TransactionStatus,
	value = "GABC...WXYZ",
) =>
	render(
		<TransactionModal
			action={action}
			status={status}
			value={value}
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

describe("TransactionModal, compliance actions", () => {
	it.each<[ComplianceModalAction, string, string, string, string]>([
		[
			"allow-address",
			"GABC...WXYZ",
			"Signing adds GABC...WXYZ to the allowlist.",
			"Address allowed",
			"GABC...WXYZ is on the allowlist.",
		],
		[
			"freeze-shares",
			"5.00 shares of GABC...WXYZ",
			"Signing freezes 5.00 shares of GABC...WXYZ.",
			"Shares frozen",
			"Froze 5.00 shares of GABC...WXYZ.",
		],
		[
			"force-transfer",
			"5.00 shares from GABC...WXYZ to CVAU...LTID",
			"Signing moves 5.00 shares from GABC...WXYZ to CVAU...LTID.",
			"Transfer forced",
			"Moved 5.00 shares from GABC...WXYZ to CVAU...LTID.",
		],
	])("names what %s changes", (action, value, signing, done, doneBody) => {
		const { unmount } = renderComplianceModal(
			action,
			{ status: "awaiting-signature" },
			value,
		)
		expect(screen.getByText(signing)).toBeTruthy()
		unmount()

		renderComplianceModal(action, { status: "confirmed" }, value)
		expect(screen.getByRole("heading", { name: done })).toBeTruthy()
		expect(screen.getByText(doneBody)).toBeTruthy()
	})

	it.each<[ComplianceModalAction, number, string, RegExp]>([
		["freeze-shares", 300, "share token", /does not hold enough shares/],
		["unfreeze-shares", 301, "share token", /cannot be negative/],
		["unfreeze-shares", 303, "share token", /that many frozen shares/],
		["freeze-address", 2000, "share token", /does not hold the role/],
		["allow-address", 2000, "identity verifier", /does not hold the role/],
		["disallow-address", 2001, "identity verifier", /verifier has no admin/],
	])(
		"names the reason %s was refused with code %i",
		(action, code, refuser, sentence) => {
			renderComplianceModal(action, {
				status: "failed",
				failure: { kind: "contract-error", code },
			})

			expect(
				screen.getByRole("heading", {
					name: `The ${refuser} refused this request`,
				}),
			).toBeTruthy()
			expect(screen.getByText(sentence)).toBeTruthy()
		},
	)

	it("sends an unknown outcome to the Compliance tab", () => {
		renderComplianceModal("unfreeze-address", {
			status: "failed",
			failure: { kind: "unknown" },
		})

		expect(
			screen.getByText(/check the Compliance tab before trying again/),
		).toBeTruthy()
	})
})

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

const renderClaimWindDownModal = (status: ClaimWindDownStatus) =>
	render(
		<TransactionModal
			action="claim-wind-down"
			status={status}
			amount="25.00"
			ticker="USDC"
			shareTicker="vUSDC"
			onClose={vi.fn()}
			onRetry={vi.fn()}
		/>,
	)

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

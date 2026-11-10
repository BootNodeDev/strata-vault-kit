import type * as AppLib from "@stellar-scaffold/app-lib"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { VaultError } from "../../../../app-lib/clients/async_vault/src/index"
import { type RequestDepositStatus } from "../../hooks/useRequestDeposit"
import { contractErrorCode } from "../../test/contractErrorCode"
import { renderModal } from "../../test/renderTransactionModal"
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
			{
				status: "failed",
				failure: {
					kind: "contract-error",
					code: contractErrorCode(VaultError, "RequestOutstanding"),
					name: "RequestOutstanding",
				},
			},
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
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "RequestOutstanding"),
				name: "RequestOutstanding",
			},
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
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "SetupOpen"),
				name: "SetupOpen",
			},
		})

		expect(screen.getByText(/setup is still open/)).toBeTruthy()
		expect(screen.getByText(/once it closes/)).toBeTruthy()
	})

	it("names FeedNotValid as subscriptions paused until the price feed is valid again", () => {
		renderModal({
			status: "failed",
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "FeedNotValid"),
				name: "FeedNotValid",
			},
		})

		expect(screen.getByText(/price feed is not valid right now/)).toBeTruthy()
		expect(screen.getByText(/subscriptions are paused/)).toBeTruthy()
	})

	it("names EscrowNotCovered as subscriptions refused until the vault is funded again", () => {
		renderModal({
			status: "failed",
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "EscrowNotCovered"),
				name: "EscrowNotCovered",
			},
		})

		expect(
			screen.getByText(/enough to cover its pending deposits/),
		).toBeTruthy()
		expect(
			screen.getByText(/not taking new subscriptions until it is funded again/),
		).toBeTruthy()
	})

	it("falls back to a generic refusal for a contract error it does not recognize, without the raw code", () => {
		renderModal({
			status: "failed",
			failure: { kind: "contract-error", code: 9999, name: undefined },
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
			failure: { kind: "contract-error", code: 9999, name: undefined },
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

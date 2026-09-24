import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type RequestDepositStatus } from "../../hooks/useRequestDeposit"
import SubscriptionModal from "./SubscriptionModal"

const { explorerTransactionMock } = vi.hoisted(() => ({
	explorerTransactionMock: vi.fn(() => null as string | null),
}))

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: explorerTransactionMock,
}))

const renderModal = (status: RequestDepositStatus) => {
	const onClose = vi.fn()
	const onRetry = vi.fn()
	const view = render(
		<SubscriptionModal
			status={status}
			amount="150.00"
			ticker="USDC"
			onClose={onClose}
			onRetry={onRetry}
		/>,
	)
	return { ...view, onClose, onRetry }
}

describe("SubscriptionModal", () => {
	it("renders nothing while idle", () => {
		renderModal({ status: "idle" })

		expect(screen.queryByRole("dialog")).toBeNull()
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

	it("gives the confirmed moment the weight of an arrival, announced to assistive tech", () => {
		renderModal({ status: "confirmed", epochId: 7n, hash: "b".repeat(64) })

		const arrival = screen.getByRole("status")
		expect(
			within(arrival).getByRole("heading", { name: "Request locked in" }),
		).toBeTruthy()
	})

	it("does not mark any other state as an arrival", () => {
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

	it("shows the approval step as current while awaiting a signature, and the rest ahead", () => {
		renderModal({ status: "awaiting-signature" })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, in progress",
			"Sent to the network",
			"Recorded",
		])
		expect(screen.getByRole("listitem", { current: "step" }).textContent).toBe(
			"Approved in your wallet, in progress",
		)
	})

	it("marks approval done and sending current once submitted", () => {
		renderModal({ status: "submitted", hash: "a".repeat(64) })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, done",
			"Sent to the network, in progress",
			"Recorded",
		])
	})

	it("marks every step done once confirmed", () => {
		renderModal({ status: "confirmed", epochId: 7n })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, done",
			"Sent to the network, done",
			"Recorded, done",
		])
	})

	it("interrupts the approval step, not a fourth step, when the investor declines", () => {
		renderModal({ status: "failed", failure: { kind: "declined" } })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, failed",
			"Sent to the network",
			"Recorded",
		])
	})

	it("interrupts the approval step when the vault refuses before any signature is asked for", () => {
		renderModal({
			status: "failed",
			failure: { kind: "contract-error", code: 6009 },
		})

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, failed",
			"Sent to the network",
			"Recorded",
		])
	})

	it("interrupts recording, not sending, when a submitted transaction cannot be confirmed", () => {
		renderModal({
			status: "failed",
			failure: { kind: "unknown" },
			hash: "c".repeat(64),
		})

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, done",
			"Sent to the network, done",
			"Recorded, failed",
		])
	})

	it("interrupts sending, not recording, when an unknown failure never reached the network", () => {
		renderModal({ status: "failed", failure: { kind: "unknown" } })

		const steps = screen.getAllByRole("listitem")
		expect(steps.map((step) => step.textContent)).toEqual([
			"Approved in your wallet, done",
			"Sent to the network, failed",
			"Recorded",
		])
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

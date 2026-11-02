import { formatDate, type SubmitFailure } from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { act, fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import TransactionModal, {
	type EmergencyModalAction,
} from "../TransactionModal"
import { renderModal, renderEmergencyModal } from "./renderModal"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: () => null,
}))

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

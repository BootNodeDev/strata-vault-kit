import { type Amount, type Price } from "@stellar-scaffold/app-lib"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { VaultError } from "../../../../../app-lib/clients/async_vault/src/index"
import { contractErrorCode } from "../../../test/contractErrorCode"
import {
	renderCloseEpochModal,
	renderFulfillEpochModal,
	renderAttestModal,
	renderDeployModal,
	renderFundModal,
	renderActivateModal,
	renderFinalizeModal,
} from "../../../test/renderTransactionModal"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: () => null,
}))

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

	it.each<[string, RegExp]>([
		["WindDownActive", /winding down/],
		["EpochNotFound", /current epoch could not be found/],
		["EpochNotOpen", /not open/],
		["Unauthorized", /not authorized to close/],
		["RoleNotHeld", /does not hold the manager role/],
		["MinEpochDurationNotElapsed", /Only the manager can seal this epoch/],
		["SetupOpen", /setup is still open, so no epoch can be sealed/],
	])("names the vault's reason for %s", (name, sentence) => {
		renderCloseEpochModal({
			status: "failed",
			failure: { kind: "contract-error", code: 0, name },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a close error it does not recognize, without the raw code", () => {
		renderCloseEpochModal({
			status: "failed",
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "RequestNotFound"),
				name: "RequestNotFound",
			},
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

	it.each<[string, RegExp]>([
		["WindDownActive", /winding down/],
		["EpochNotFound", /epoch could not be found/],
		["EpochNotPending", /not sealed/],
		["NoticeNotElapsed", /notice period has not elapsed/],
		["FeedNotValid", /price is not valid/],
		["AttestationBeforeClose", /attested before this epoch was sealed/],
		["InvalidSharePrice", /could not resolve a valid share price/],
		["AmountTooLarge", /too large/],
		["EnforcedPause", /paused/],
		["SetupOpen", /setup is still open, so no epoch can be priced/],
	])("names the vault's reason for %s", (name, sentence) => {
		renderFulfillEpochModal({
			status: "failed",
			failure: { kind: "contract-error", code: 0, name },
		})

		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a settlement error it does not recognize, without the raw code", () => {
		renderFulfillEpochModal({
			status: "failed",
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "AlreadyClaimed"),
				name: "AlreadyClaimed",
			},
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

	it.each<[string, RegExp]>([
		["NavOutOfBand", /outside the band/],
		["ExpiresInPast", /already have expired/],
		["CooldownActive", /cooldown .* has not elapsed/],
		["DeviationExceeded", /moves further from the last attested price/],
		["NavPaused", /^Unpause the NAV first\.$/],
		["EmptyProofHash", /^The proof hash cannot be all zeros\.$/],
		["ProofUriTooLong", /^The proof URI is longer than 256 bytes\.$/],
	])("names the oracle's reason for %s", (name, sentence) => {
		renderAttestModal({
			status: "failed",
			failure: { kind: "contract-error", code: 0, name },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it.each<[number, string]>([
		[2000, "Unauthorized"],
		[2007, "RoleNotHeld"],
	])(
		"falls back to a generic refusal for code %i, without the raw code",
		(code, name) => {
			renderAttestModal({
				status: "failed",
				failure: { kind: "contract-error", code, name },
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

	it.each<[string, RegExp]>([
		["WindDownActive", /winding down/],
		["InvalidAmount", /greater than zero/],
		["CustodianNotSet", /No custodian is set/],
		["ReserveCommittedToExits", /free reserve/],
		["AmountTooLarge", /too large/],
		["Unauthorized", /not authorized/],
		["RoleNotHeld", /treasury role/],
	])("names the vault's reason for %s", (name, sentence) => {
		renderDeployModal({
			status: "failed",
			failure: { kind: "contract-error", code: 0, name },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a code it does not recognize, without the raw code", () => {
		renderDeployModal({
			status: "failed",
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "EpochNotFound"),
				name: "EpochNotFound",
			},
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

	it.each<[string, RegExp]>([
		["InvalidAmount", /greater than zero/],
		["AmountTooLarge", /too large/],
	])("names the vault's reason for %s", (name, sentence) => {
		renderFundModal({
			status: "failed",
			failure: { kind: "contract-error", code: 0, name },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("points the funder at their balance and trustline when the asset transfer refuses, without the raw code", () => {
		renderFundModal({
			status: "failed",
			failure: { kind: "contract-error", code: 10, name: undefined },
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

	it.each<[string, RegExp]>([
		["WindDownNotProposed", /No wind-down has been proposed/],
		["WindDownActive", /already active/],
		["WindDownDelayNotElapsed", /delay has not elapsed/],
	])("names the vault's reason for %s", (name, sentence) => {
		renderActivateModal({
			status: "failed",
			failure: { kind: "contract-error", code: 0, name },
		})

		expect(
			screen.getByRole("heading", { name: "The vault refused this request" }),
		).toBeTruthy()
		expect(screen.getByText(sentence)).toBeTruthy()
	})

	it("falls back to a generic refusal for a code it does not recognize, without the raw code", () => {
		renderActivateModal({
			status: "failed",
			failure: {
				kind: "contract-error",
				code: contractErrorCode(VaultError, "WindDownNotActive"),
				name: "WindDownNotActive",
			},
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

	it.each<[string, RegExp]>([
		["WindDownNotActive", /not active/],
		["NothingToDistribute", /nothing to distribute/],
		["AmountTooLarge", /too large/],
	])("names the vault's reason for %s", (name, sentence) => {
		renderFinalizeModal({
			status: "failed",
			failure: { kind: "contract-error", code: 0, name },
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

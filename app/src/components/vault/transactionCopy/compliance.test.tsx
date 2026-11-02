import type * as AppLib from "@stellar-scaffold/app-lib"
import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { renderComplianceModal } from "../../../test/renderTransactionModal"
import { type ComplianceModalAction } from "../TransactionModal"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: () => null,
}))

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
			"legal-transfer",
			"5.00 shares from GABC...WXYZ to GDEF...UVWX",
			"Signing approves moving 5.00 shares from GABC...WXYZ to GDEF...UVWX.",
			"Legal transfer made",
			"Moved 5.00 shares from GABC...WXYZ to GDEF...UVWX.",
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

	it.each<[ComplianceModalAction, string, string, RegExp]>([
		[
			"freeze-shares",
			"InsufficientBalance",
			"share token",
			/does not hold enough shares/,
		],
		["unfreeze-shares", "LessThanZero", "share token", /cannot be negative/],
		[
			"unfreeze-shares",
			"InsufficientFreeTokens",
			"share token",
			/that many frozen shares/,
		],
		["freeze-address", "Unauthorized", "share token", /does not hold the role/],
		[
			"allow-address",
			"Unauthorized",
			"identity verifier",
			/does not hold the role/,
		],
		[
			"disallow-address",
			"AdminNotSet",
			"identity verifier",
			/verifier has no admin/,
		],
		[
			"legal-transfer",
			"CoSignRequired",
			"share token",
			/compliance account and the token admin must be two different accounts/,
		],
		[
			"legal-transfer",
			"InvalidReference",
			"share token",
			/reference of 1 to 128 bytes/,
		],
		[
			"legal-transfer",
			"VaultAddress",
			"share token",
			/never moves shares into or out of the vault/,
		],
		[
			"legal-transfer",
			"IdentityVerificationFailed",
			"share token",
			/destination is not allowlisted/,
		],
		[
			"legal-transfer",
			"InsufficientBalance",
			"share token",
			/does not hold enough shares/,
		],
	])(
		"names the reason %s was refused with %s",
		(action, name, refuser, sentence) => {
			renderComplianceModal(action, {
				status: "failed",
				failure: { kind: "contract-error", code: 0, name },
			})

			expect(
				screen.getByRole("heading", {
					name: `The ${refuser} refused this request`,
				}),
			).toBeTruthy()
			expect(screen.getByText(sentence)).toBeTruthy()
		},
	)

	it("asks for the token admin's authorization before compliance signs", () => {
		renderComplianceModal("legal-transfer", {
			status: "shared",
			xdr: "AAAAXDR",
			standing: "admin-authorization",
			expiresAt: null,
		})

		expect(
			screen.getByRole("heading", {
				name: "Needs the token admin's authorization",
			}),
		).toBeTruthy()
		expect(
			screen.getByText(
				"Share the link with the token admin. Once they authorize it, compliance's signers sign it.",
			),
		).toBeTruthy()
		expect(
			screen.getByRole<HTMLInputElement>("textbox", { name: "Signing link" })
				.value,
		).toBe(`${window.location.origin}/sign#AAAAXDR`)
	})

	it("names the wallets that can sign an authorization", () => {
		renderComplianceModal("legal-transfer", {
			status: "failed",
			failure: { kind: "cannot-authorize" },
		})

		expect(
			screen.getByText(
				"This wallet cannot sign authorizations. Use Freighter, Hana or WalletConnect.",
			),
		).toBeTruthy()
		expect(screen.queryByText("You declined the request")).toBeNull()
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
	})

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

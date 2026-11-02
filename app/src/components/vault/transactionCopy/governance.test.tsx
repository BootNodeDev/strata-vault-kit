import type * as AppLib from "@stellar-scaffold/app-lib"
import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { renderGovernanceModal } from "../../../test/renderTransactionModal"
import { type GovernanceModalAction } from "../TransactionModal"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: () => null,
}))

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

	it.each<[GovernanceModalAction, string, string, RegExp]>([
		["grant-vault-role", "Unauthorized", "vault", /does not hold the role/],
		["revoke-oracle-role", "IndexOutOfBounds", "oracle", /holders changed/],
		[
			"revoke-token-role",
			"RoleNotHeld",
			"share token",
			/does not hold this role/,
		],
		[
			"grant-oracle-role",
			"MaxRolesExceeded",
			"oracle",
			/The oracle already has the maximum number of roles/,
		],
		[
			"cancel-vault-handover",
			"NoPendingTransfer",
			"vault",
			/no pending handover/,
		],
		[
			"hand-over-oracle-admin",
			"InvalidLiveUntilLedger",
			"oracle",
			/expiry is outside/,
		],
		[
			"cancel-token-handover",
			"InvalidPendingAccount",
			"share token",
			/different address/,
		],
		[
			"accept-vault-admin",
			"TransferExpired",
			"vault",
			/expired before it was accepted/,
		],
		[
			"accept-vault-admin",
			"WindDownActive",
			"vault",
			/admin role can no longer change hands/,
		],
		[
			"accept-oracle-admin",
			"WindDownActive",
			"oracle",
			/admin role can no longer change hands/,
		],
		[
			"accept-token-admin",
			"WindDownActive",
			"share token",
			/admin role can no longer change hands/,
		],
		["apply-change", "EnforcedPause", "vault", /The vault is paused/],
		["apply-change", "WindDownActive", "vault", /winding down/],
		[
			"propose-wind-down",
			"WindDownActive",
			"vault",
			/wind-down is already active/,
		],
		[
			"cancel-wind-down",
			"WindDownNotProposed",
			"vault",
			/No wind-down is proposed/,
		],
		[
			"propose-wind-down",
			"WindDownAlreadyProposed",
			"vault",
			/wind-down is already proposed/,
		],
		[
			"propose-code-upgrade",
			"UpgradeProposalExists",
			"vault",
			/code change is already pending/,
		],
		[
			"cancel-change",
			"ChangeNotFound",
			"vault",
			/no pending change with that id/,
		],
		["apply-change", "ChangeNotReady", "vault", /delay has not passed yet/],
		[
			"propose-grant-role",
			"TooManyPendingChanges",
			"vault",
			/16 pending changes/,
		],
		["propose-admin", "SetupOpen", "vault", /Setup is still open/],
		["grant-vault-role", "UseTimelock", "vault", /goes through the timelock/],
		[
			"propose-upgrade-delay",
			"UpgradeDelayTooShort",
			"vault",
			/cannot be under 7 days/,
		],
		[
			"propose-upgrade-delay",
			"UpgradeDelayBelowNotice",
			"vault",
			/cannot be under the notice/,
		],
		[
			"propose-upgrade-delay",
			"UpgradeDelayTooLong",
			"vault",
			/cannot exceed 90 days/,
		],
		[
			"cancel-token-change",
			"ChangeNotFound",
			"share token",
			/no pending change with that id/,
		],
		[
			"apply-token-change",
			"ChangeNotReady",
			"share token",
			/delay has not passed yet/,
		],
		[
			"propose-token-grant-role",
			"TooManyPendingChanges",
			"share token",
			/16 pending changes/,
		],
		["propose-token-admin", "SetupOpen", "share token", /Setup is still open/],
		[
			"grant-token-role",
			"UseTimelock",
			"share token",
			/goes through the timelock/,
		],
		[
			"apply-token-change",
			"WindDownActive",
			"share token",
			/vault is winding down/,
		],
		["apply-token-change", "VaultPaused", "share token", /vault is paused/],
		[
			"apply-token-change",
			"UpgradeAlreadyPending",
			"share token",
			/upgrade is already pending/,
		],
		[
			"hand-over-token-admin",
			"AdminTransferPending",
			"share token",
			/hand-over is still pending/,
		],
		[
			"cancel-oracle-change",
			"ChangeNotFound",
			"oracle",
			/no pending change with that id/,
		],
		[
			"apply-oracle-change",
			"ChangeNotReady",
			"oracle",
			/delay has not passed yet/,
		],
		[
			"propose-oracle-grant-role",
			"TooManyPendingChanges",
			"oracle",
			/16 pending changes/,
		],
		["propose-oracle-admin", "SetupOpen", "oracle", /Setup is still open/],
		["grant-oracle-role", "UseTimelock", "oracle", /goes through the timelock/],
		[
			"apply-oracle-change",
			"SetupClosed",
			"oracle",
			/setup has already finished/,
		],
		["apply-oracle-change", "VaultNotBound", "oracle", /not bound to a vault/],
		[
			"apply-oracle-change",
			"WindDownActive",
			"oracle",
			/vault is winding down/,
		],
		[
			"apply-oracle-change",
			"VaultPaused",
			"oracle",
			/holds every oracle change/,
		],
		[
			"apply-oracle-change",
			"DelayBelowNotice",
			"oracle",
			/shorter than the vault's notice/,
		],
		[
			"propose-oracle-upgrade",
			"UpgradeAlreadyPending",
			"oracle",
			/upgrade is already pending/,
		],
	])(
		"names the reason %s was refused with %s",
		(action, name, refuser, sentence) => {
			renderGovernanceModal(action, {
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
			"propose-oracle-grant-role",
			"Attester to GABC...WXYZ",
			"Signing queues the grant of Attester to GABC...WXYZ.",
			"Change proposed",
			"The grant of Attester to GABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"propose-oracle-admin",
			"GABC...WXYZ",
			"Signing queues the hand-over to GABC...WXYZ.",
			"Change proposed",
			"The hand-over to GABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"propose-oracle-upgrade",
			"Code abab...abab",
			"Signing queues Code abab...abab.",
			"Upgrade proposed",
			"Code abab...abab can apply once the vault's upgrade delay passes.",
		],
		[
			"apply-oracle-change",
			"oracle change #1: Admin hand-over GABC...WXYZ",
			"Signing applies oracle change #1: Admin hand-over GABC...WXYZ.",
			"Change applied",
			"Applied oracle change #1: Admin hand-over GABC...WXYZ.",
		],
		[
			"cancel-oracle-change",
			"oracle change #1: Admin hand-over GABC...WXYZ",
			"Signing withdraws oracle change #1: Admin hand-over GABC...WXYZ.",
			"Change cancelled",
			"Withdrew oracle change #1: Admin hand-over GABC...WXYZ.",
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

	it.each<[GovernanceModalAction, number, string]>([
		["propose-grant-role", 6074, "vault"],
		["propose-oracle-grant-role", 3025, "oracle"],
		["propose-token-grant-role", 7016, "share token"],
	])(
		"names a pending admin hand-over on %s, whichever contract raises it",
		(action, code, refuser) => {
			renderGovernanceModal(action, {
				status: "failed",
				failure: { kind: "contract-error", code, name: "AdminTransferPending" },
			})

			expect(
				screen.getByRole("heading", {
					name: `The ${refuser} refused this request`,
				}),
			).toBeTruthy()
			expect(
				screen.getByText(
					"An admin hand-over is still pending; cancel it first.",
				),
			).toBeTruthy()
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

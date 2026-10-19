import { Buffer } from "buffer"
import { type Transaction } from "@stellar/stellar-sdk"
import {
	type AccountSigners,
	InvalidPendingTransaction,
	type PendingTransaction,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import {
	describeCollected,
	describeExpiry,
	describePending,
	type PendingStateInput,
	pendingState,
	primaryAction,
	toModalProps,
} from "./sign"

const addresses = {
	vault: "CVAULT",
	oracle: "CORACLE",
	shareToken: "CTOKEN",
	identityVerifier: "CVERIFIER",
}

const account = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
const other = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3"

const pending = (
	contractId: string,
	fn: string,
	args: unknown[],
): PendingTransaction => ({
	transaction: {} as Transaction,
	source: account,
	sequence: "42",
	expiresAt: new Date("2026-10-22T00:00:00Z"),
	contractId,
	fn,
	args,
	hash: "abc123",
})

describe("describePending", () => {
	it("maps a vault setter with an amount argument", () => {
		expect(
			describePending(
				pending(addresses.vault, "set_deposit_cap", [1_500_000_000n, account]),
				addresses,
			),
		).toEqual({
			contract: "Vault",
			action: "set-deposit-cap",
			label: "Set the deposit cap",
			args: [{ label: "Deposit cap", value: "150.00" }],
		})
	})

	it("shows an absent deposit cap as no cap", () => {
		const { args } = describePending(
			pending(addresses.vault, "set_deposit_cap", [null, account]),
			addresses,
		)

		expect(args).toEqual([{ label: "Deposit cap", value: "No cap" }])
	})

	it("reads a handover cancellation from a zero ledger", () => {
		expect(
			describePending(
				pending(addresses.vault, "transfer_admin_role", [other, 0]),
				addresses,
			),
		).toEqual({
			contract: "Vault",
			action: "cancel-vault-handover",
			label: "Cancel the handover",
			args: [{ label: "New admin", value: "GDQN...KTL3" }],
		})
	})

	it("maps a handover with its ledger limit", () => {
		expect(
			describePending(
				pending(addresses.oracle, "transfer_admin_role", [other, 1234]),
				addresses,
			),
		).toEqual({
			contract: "Oracle",
			action: "hand-over-oracle-admin",
			label: "Hand over the admin",
			args: [
				{ label: "New admin", value: "GDQN...KTL3" },
				{ label: "Open until ledger", value: "1234" },
			],
		})
	})

	it("maps the ripcord flag to raise or lower", () => {
		const raise = describePending(
			pending(addresses.oracle, "set_ripcord", [true, account]),
			addresses,
		)
		const lower = describePending(
			pending(addresses.oracle, "set_ripcord", [false, account]),
			addresses,
		)

		expect(raise.action).toBe("raise-ripcord")
		expect(lower.action).toBe("lower-ripcord")
		expect(lower.label).toBe("Lower the ripcord")
	})

	it("formats an attestation price and expiry", () => {
		expect(
			describePending(
				pending(addresses.oracle, "attest", [
					{
						nav_per_share: 1_050_000_000_000_000_000n,
						expires_at: 1_800_000_000n,
						timestamp: 0n,
					},
					account,
				]),
				addresses,
			),
		).toEqual({
			contract: "Oracle",
			action: "attest",
			label: "Attest the price",
			args: [
				{ label: "Price", value: "1.0500" },
				{ label: "Expires", value: "15 Jan 2027" },
			],
		})
	})

	it("maps a forced transfer with shortened addresses and an amount", () => {
		expect(
			describePending(
				pending(addresses.shareToken, "forced_transfer", [
					account,
					other,
					25_000_000n,
					account,
				]),
				addresses,
			),
		).toEqual({
			contract: "Share token",
			action: "force-transfer",
			label: "Force a transfer",
			args: [
				{ label: "From", value: "GBRP...OX2H" },
				{ label: "To", value: "GDQN...KTL3" },
				{ label: "Amount", value: "2.50" },
			],
		})
	})

	it("maps a role grant on the share token", () => {
		expect(
			describePending(
				pending(addresses.shareToken, "grant_role", [
					other,
					"compliance",
					account,
				]),
				addresses,
			),
		).toEqual({
			contract: "Share token",
			action: "grant-token-role",
			label: "Grant a role",
			args: [
				{ label: "Role", value: "compliance" },
				{ label: "Account", value: "GDQN...KTL3" },
			],
		})
	})

	it("maps the configured identity verifier", () => {
		expect(
			describePending(
				pending(addresses.identityVerifier, "allow", [other, false, account]),
				addresses,
			),
		).toEqual({
			contract: "Identity verifier",
			action: "disallow-address",
			label: "Remove the address from the allowlist",
			args: [{ label: "Address", value: "GDQN...KTL3" }],
		})
	})

	it("refuses a contract that is not one of the configured four", () => {
		expect(() =>
			describePending(
				pending("CFOREIGN", "allow", [other, true, account]),
				addresses,
			),
		).toThrow(new InvalidPendingTransaction("unknown contract"))
	})

	it("maps the cycle operations the console can propose", () => {
		expect(
			describePending(
				pending(addresses.vault, "close_epoch", [account]),
				addresses,
			),
		).toMatchObject({ action: "close-epoch", label: "Close the epoch" })
		expect(
			describePending(
				pending(addresses.vault, "deploy_to_custodian", [
					account,
					1_000_000_000n,
				]),
				addresses,
			),
		).toMatchObject({
			action: "deploy",
			label: "Deploy to the custodian",
			args: [{ label: "Amount", value: "100.00" }],
		})
	})

	it("shows a code upgrade hash in hex", () => {
		const { args } = describePending(
			pending(addresses.vault, "propose_upgrade", [
				Buffer.from("abcd", "hex"),
				account,
			]),
			addresses,
		)

		expect(args).toEqual([{ label: "Wasm hash", value: "abcd" }])
	})

	it("refuses an operation the console does not propose", () => {
		expect(() =>
			describePending(
				pending(addresses.vault, "request_deposit", [account, 1n]),
				addresses,
			),
		).toThrow(new InvalidPendingTransaction("unknown operation"))
		expect(() =>
			describePending(pending("CSOMEWHERE", "pause", [account]), addresses),
		).toThrow(new InvalidPendingTransaction("unknown contract"))
	})

	it("refuses arguments of the wrong shape", () => {
		expect(() =>
			describePending(
				pending(addresses.vault, "set_custodian", [12n, account]),
				addresses,
			),
		).toThrow(InvalidPendingTransaction)
	})
})

const now = new Date("2026-10-15T12:00:00Z")

const base: PendingStateInput = {
	now,
	expiresAt: new Date("2026-10-22T12:00:00Z"),
	sequence: "43",
	accountSequence: "42",
	weight: 1,
	threshold: 2,
	walletIsSigner: true,
	walletHasSigned: false,
}

describe("pendingState", () => {
	it.each([
		["valid", {}],
		["expired", { expiresAt: new Date("2026-10-15T11:59:59Z") }],
		["consumed", { accountSequence: "43" }],
		["not-signer", { walletIsSigner: false }],
		["already-signed", { walletHasSigned: true }],
		["ready", { weight: 2 }],
	] as const)("is %s", (state, overrides) => {
		expect(pendingState({ ...base, ...overrides })).toBe(state)
	})

	it("stays valid without an expiry, an account read or a wallet", () => {
		expect(
			pendingState({
				...base,
				expiresAt: null,
				accountSequence: null,
				walletIsSigner: null,
			}),
		).toBe("valid")
	})

	it("ranks expiry over a complete signature set", () => {
		expect(
			pendingState({
				...base,
				weight: 2,
				expiresAt: new Date("2026-10-15T11:00:00Z"),
			}),
		).toBe("expired")
	})
})

const signers: AccountSigners = {
	signers: [
		{ key: account, weight: 1 },
		{ key: other, weight: 1 },
	],
	thresholds: { low: 1, med: 2, high: 2 },
	sequence: "42",
}

describe("describeCollected", () => {
	it("counts signatures when every signer weighs one", () => {
		expect(describeCollected(1, signers)).toBe("1 of 2 signatures")
	})

	it("reports weight against the threshold otherwise", () => {
		expect(
			describeCollected(2, {
				...signers,
				signers: [
					{ key: account, weight: 2 },
					{ key: other, weight: 1 },
				],
				thresholds: { low: 1, med: 3, high: 3 },
			}),
		).toBe("weight 2 of threshold 3")
	})
})

describe("describeExpiry", () => {
	it("shows the date and the UTC time", () => {
		expect(describeExpiry(new Date("2027-01-15T08:05:00Z"))).toBe(
			"15 Jan 2027, 08:05 UTC",
		)
	})

	it("names a transaction without expiry", () => {
		expect(describeExpiry(null)).toBe("No expiry")
	})
})

describe("primaryAction", () => {
	it("offers Submit when the signatures are complete", () => {
		expect(primaryAction("ready", false, false)).toEqual({
			label: "Submit",
			enabled: true,
		})
	})

	it("offers Sign to a connected wallet while waiting", () => {
		expect(primaryAction("valid", true, true)).toEqual({
			label: "Sign",
			enabled: true,
		})
		expect(primaryAction("valid", true, false)).toEqual({
			label: "Sign",
			enabled: false,
		})
	})

	it("asks for a wallet when none is connected", () => {
		expect(primaryAction("valid", false, false)).toEqual({
			label: "Connect a wallet to sign",
			enabled: false,
		})
	})

	it("offers nothing in every other state", () => {
		for (const state of [
			"expired",
			"consumed",
			"executed",
			"not-signer",
			"already-signed",
		] as const) {
			expect(primaryAction(state, true, false)).toBeNull()
		}
	})
})

describe("toModalProps", () => {
	const handlers = { onClose: () => {}, onRetry: () => {} }

	it("passes the sealed epoch through for a confirmed close", () => {
		const description = describePending(
			pending(addresses.vault, "close_epoch", [account]),
			addresses,
		)

		expect(
			toModalProps(
				description,
				{ status: "confirmed", hash: "abc123", result: 7n },
				handlers,
			),
		).toMatchObject({
			action: "close-epoch",
			status: { status: "confirmed", hash: "abc123", sealedEpoch: 7n },
		})
	})

	it("joins the arguments as the admin value", () => {
		const description = describePending(
			pending(addresses.shareToken, "grant_role", [
				other,
				"compliance",
				account,
			]),
			addresses,
		)

		expect(
			toModalProps(description, { status: "submitted" }, handlers),
		).toMatchObject({
			action: "grant-token-role",
			value: "compliance, GDQN...KTL3",
		})
	})

	it("hands the attestation price to the attest modal", () => {
		const description = describePending(
			pending(addresses.oracle, "attest", [
				{
					nav_per_share: 1_050_000_000_000_000_000n,
					expires_at: 1_800_000_000n,
					timestamp: 0n,
				},
				account,
			]),
			addresses,
		)

		expect(
			toModalProps(description, { status: "submitted" }, handlers),
		).toMatchObject({ action: "attest", price: "1.0500", validFor: null })
	})
})

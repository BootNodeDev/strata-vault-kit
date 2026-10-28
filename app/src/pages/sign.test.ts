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
				pending(addresses.vault, "set_deposit_cap", [1_500_000_000n]),
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
			pending(addresses.vault, "set_deposit_cap", [null]),
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

	it("maps the paused flag to pause or unpause", () => {
		const pause = describePending(
			pending(addresses.oracle, "set_nav_paused", [true, account]),
			addresses,
		)
		const unpause = describePending(
			pending(addresses.oracle, "set_nav_paused", [false, account]),
			addresses,
		)

		expect(pause.action).toBe("pause-nav")
		expect(pause.label).toBe("Pause the NAV")
		expect(unpause.action).toBe("unpause-nav")
		expect(unpause.label).toBe("Unpause the NAV")
	})

	it("describes the guardian's pause_nav as pausing the NAV", () => {
		expect(
			describePending(
				pending(addresses.oracle, "pause_nav", [account]),
				addresses,
			),
		).toMatchObject({ action: "pause-nav", label: "Pause the NAV", args: [] })
	})

	it("shows every oracle limit of set_config, the largest fall as a percent", () => {
		const { args } = describePending(
			pending(addresses.oracle, "set_config", [
				{
					freshness_duration: 86_400n,
					cooldown_secs: 3_600n,
					max_up_bps: 500,
					max_down_bps: 250,
					min_answer: 500_000_000_000_000_000n,
					max_answer: 2_000_000_000_000_000_000n,
				},
				account,
			]),
			addresses,
		)

		expect(args).toEqual([
			{ label: "Freshness window", value: "1d" },
			{ label: "Cooldown", value: "1h" },
			{ label: "Largest rise", value: "5%" },
			{ label: "Largest fall", value: "2.5%" },
			{ label: "Price floor", value: "0.50" },
			{ label: "Price ceiling", value: "2.00" },
		])
	})

	it("formats an attestation price, expiry and proof", () => {
		expect(
			describePending(
				pending(addresses.oracle, "attest", [
					{
						nav_per_share: 1_050_000_000_000_000_000n,
						expires_at: 1_800_000_000n,
						proof_hash: Buffer.alloc(32, 0xab),
						proof_uri: "https://example.com/nav.pdf",
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
				{ label: "Proof hash", value: "ab".repeat(32) },
				{ label: "Proof URI", value: "https://example.com/nav.pdf" },
			],
		})
	})

	it("shows an attestation without a proof URI as none", () => {
		const { args } = describePending(
			pending(addresses.oracle, "attest", [
				{
					nav_per_share: 1_050_000_000_000_000_000n,
					expires_at: 1_800_000_000n,
					proof_hash: Buffer.alloc(32, 0xab),
					proof_uri: "",
				},
				account,
			]),
			addresses,
		)

		expect(args.at(-1)).toEqual({ label: "Proof URI", value: "None" })
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
				pending(addresses.identityVerifier, "allow", [other, false]),
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

	it.each<[unknown[], string, { label: string; value: string }[]]>([
		[
			["Custodian", account],
			"propose-custodian",
			[{ label: "Custodian", value: "GBRP...OX2H" }],
		],
		[
			["Notice", 43_200n],
			"propose-notice",
			[{ label: "Notice", value: "12h" }],
		],
		[
			["WindDownDelay", 691_200n],
			"propose-wind-down-delay",
			[{ label: "Wind-down delay", value: "8d" }],
		],
		[
			["Upgrade", Buffer.from("abcd", "hex")],
			"propose-code-upgrade",
			[{ label: "Wasm hash", value: "abcd" }],
		],
		[
			["UpgradeDelay", 1_209_600n],
			"propose-upgrade-delay",
			[{ label: "Upgrade delay", value: "14d" }],
		],
		[
			["GrantRole", "manager", account],
			"propose-grant-role",
			[
				{ label: "Role", value: "manager" },
				{ label: "Account", value: "GBRP...OX2H" },
			],
		],
		[
			["RevokeRole", "manager", account],
			"propose-revoke-role",
			[
				{ label: "Role", value: "manager" },
				{ label: "Account", value: "GBRP...OX2H" },
			],
		],
		[
			["Admin", account],
			"propose-admin",
			[{ label: "New admin", value: "GBRP...OX2H" }],
		],
	])("describes propose_change %o by its kind", (change, action, args) => {
		expect(
			describePending(
				pending(addresses.vault, "propose_change", [change]),
				addresses,
			),
		).toMatchObject({ contract: "Vault", action, args })
	})

	it("refuses a proposed change the console does not propose", () => {
		expect(() =>
			describePending(
				pending(addresses.vault, "propose_change", [["Oracle", other]]),
				addresses,
			),
		).toThrow(new InvalidPendingTransaction("unknown operation"))
	})

	it("names the pending change an apply or cancel acts on, or its id when gone", () => {
		const changes = [
			{ id: 3, change: { tag: "Custodian", values: [account] }, eta: 1n },
		]

		expect(
			describePending(
				pending(addresses.vault, "apply_change", [3]),
				addresses,
				{ vault: changes },
			),
		).toMatchObject({
			action: "apply-change",
			label: "Apply the change",
			args: [
				{ label: "Change", value: "vault change #3: Custodian GBRP...OX2H" },
			],
		})
		expect(
			describePending(
				pending(addresses.vault, "cancel_change", [4]),
				addresses,
				{ vault: changes },
			),
		).toMatchObject({
			action: "cancel-change",
			label: "Cancel the change",
			args: [{ label: "Change", value: "vault change #4" }],
		})
		expect(
			describePending(pending(addresses.vault, "apply_change", [3]), addresses)
				.args,
		).toEqual([{ label: "Change", value: "vault change #3" }])
	})

	it.each<[unknown[], string, { label: string; value: string }[]]>([
		[
			["GrantRole", "manager", account],
			"propose-token-grant-role",
			[
				{ label: "Role", value: "manager" },
				{ label: "Account", value: "GBRP...OX2H" },
			],
		],
		[
			["RevokeRole", "manager", account],
			"propose-token-revoke-role",
			[
				{ label: "Role", value: "manager" },
				{ label: "Account", value: "GBRP...OX2H" },
			],
		],
		[
			["Admin", account],
			"propose-token-admin",
			[{ label: "New admin", value: "GBRP...OX2H" }],
		],
		[
			["Compliance", other],
			"propose-compliance",
			[{ label: "Compliance contract", value: "GDQN...KTL3" }],
		],
		[
			["IdentityVerifier", other],
			"propose-identity-verifier",
			[{ label: "Identity verifier", value: "GDQN...KTL3" }],
		],
	])(
		"describes the share token's propose_change %o by its kind",
		(change, action, args) => {
			expect(
				describePending(
					pending(addresses.shareToken, "propose_change", [change]),
					addresses,
				),
			).toMatchObject({ contract: "Share token", action, args })
		},
	)

	it("refuses a proposed change the other contract owns", () => {
		for (const change of [
			["Custodian", account],
			["Upgrade", Buffer.from("abcd", "hex")],
		])
			expect(() =>
				describePending(
					pending(addresses.shareToken, "propose_change", [change]),
					addresses,
				),
			).toThrow(new InvalidPendingTransaction("unknown operation"))
		expect(() =>
			describePending(
				pending(addresses.vault, "propose_change", [["Compliance", other]]),
				addresses,
			),
		).toThrow(new InvalidPendingTransaction("unknown operation"))
	})

	it("names a share-token change from the token's own pending list", () => {
		const changes = {
			vault: [
				{ id: 1, change: { tag: "Custodian", values: [account] }, eta: 1n },
			],
			token: [
				{ id: 1, change: { tag: "Compliance", values: [other] }, eta: 1n },
			],
		}

		expect(
			describePending(
				pending(addresses.shareToken, "apply_change", [1]),
				addresses,
				changes,
			),
		).toMatchObject({
			contract: "Share token",
			action: "apply-token-change",
			label: "Apply the change",
			args: [
				{
					label: "Change",
					value: "share token change #1: Compliance contract GDQN...KTL3",
				},
			],
		})
		expect(
			describePending(
				pending(addresses.shareToken, "cancel_change", [4]),
				addresses,
				changes,
			),
		).toMatchObject({
			action: "cancel-token-change",
			label: "Cancel the change",
			args: [{ label: "Change", value: "share token change #4" }],
		})
		expect(
			describePending(
				pending(addresses.vault, "apply_change", [1]),
				addresses,
				changes,
			).args,
		).toEqual([
			{ label: "Change", value: "vault change #1: Custodian GBRP...OX2H" },
		])
	})

	it("no longer decodes the removed upgrade entrypoints", () => {
		for (const fn of [
			"propose_upgrade",
			"propose_upgrade_delay",
			"apply_upgrade",
			"cancel_upgrade",
		])
			expect(() =>
				describePending(pending(addresses.vault, fn, [account]), addresses),
			).toThrow(new InvalidPendingTransaction("unknown operation"))
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
				pending(addresses.vault, "set_custodian", [12n]),
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
					proof_hash: Buffer.alloc(32, 0xab),
					proof_uri: "",
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

import { type Transaction } from "@stellar/stellar-sdk"
import type * as AppLib from "@stellar-scaffold/app-lib"
import {
	type AccountSigners,
	networkPassphrase,
	type PendingTransaction,
} from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { addresses } from "../config/addresses"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
import { useSignPending } from "./useSignPending"

const {
	accountSignersMock,
	submitSignedMock,
	transactionStatusMock,
	tokenMock,
	vaultMock,
	oracleMock,
	linkTarget,
} = vi.hoisted(() => ({
	accountSignersMock: vi.fn(),
	submitSignedMock: vi.fn(),
	transactionStatusMock: vi.fn(),
	tokenMock: { identity_verifier: vi.fn(), pending_changes: vi.fn() },
	vaultMock: { pending_changes: vi.fn() },
	oracleMock: { pending_changes: vi.fn() },
	linkTarget: { contractId: "", expiresAt: new Date(0) },
}))

vi.mock("../config/clients", () => ({
	shareToken: async () => tokenMock,
	asyncVault: async () => vaultMock,
	navOracle: async () => oracleMock,
}))

type Marker = { signedBy: string[] }

const marked = (transaction: Transaction): Marker =>
	transaction as unknown as Marker

const authority = "GAUTHORITY"
const first = "GFIRST"
const wallet = "GWALLET"
const third = "GTHIRD"

const pendingOf = (
	fn: string,
	args: unknown[],
	signedBy: string[],
	hash = "abc123",
): PendingTransaction => ({
	transaction: { signedBy } as unknown as Transaction,
	source: authority,
	sequence: "42",
	expiresAt: linkTarget.expiresAt,
	contractId: linkTarget.contractId,
	fn,
	args,
	hash,
})

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => {
	const actual = await importOriginal<typeof AppLib>()
	return {
		...actual,
		accountSigners: accountSignersMock,
		submitSigned: submitSignedMock,
		transactionStatus: transactionStatusMock,
		decodePending: (xdr: string) => {
			const match = /^xdr:([a-z_]+):(.*)$/.exec(xdr)
			if (match === null) {
				throw new actual.InvalidPendingTransaction("not a transaction envelope")
			}
			const [, fn = "", signed = ""] = match
			const args =
				fn === "set_custodian"
					? ["GCUSTODIAN", "GAUTHORITY"]
					: fn === "allow"
						? ["GACCOUNT", true]
						: fn === "apply_change"
							? [3]
							: []
			const keys = signed === "" ? [] : signed.split(",")
			const hash = keys.includes("GTAMPERED") ? "tampered" : "abc123"
			return pendingOf(fn, args, keys, hash)
		},
		signatureWeight: (transaction: Transaction, signers: AccountSigners) => {
			const signedBy = marked(transaction).signedBy.filter((key) =>
				signers.signers.some((signer) => signer.key === key),
			)
			const weight = signers.signers
				.filter(({ key }) => signedBy.includes(key))
				.reduce((sum, signer) => sum + signer.weight, 0)
			return { signedBy, weight }
		},
		hasSigned: (transaction: Transaction, key: string) =>
			marked(transaction).signedBy.includes(key),
	}
})

const xdrSignedBy = (...keys: string[]) => `xdr:set_custodian:${keys.join(",")}`

const signers = (med: number): AccountSigners => ({
	signers: [
		{ key: first, weight: 1 },
		{ key: wallet, weight: 1 },
		{ key: third, weight: 1 },
	],
	thresholds: { low: 1, med, high: med },
	sequence: "41",
})

const walletSigns = vi.fn(async (xdr: string) => ({
	signedTxXdr: `${xdr},${wallet}`,
}))

const renderSign = (xdr: string, address: string | undefined) => {
	const context: WalletContextType = {
		address,
		networkPassphrase,
		balances: {},
		isPending: false,
		updateBalances: async () => {},
		signTransaction:
			walletSigns as unknown as WalletContextType["signTransaction"],
	}
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(WalletContext, { value: context }, children),
		)
	return renderHook(() => useSignPending(xdr), { wrapper })
}

describe("useSignPending", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		tokenMock.identity_verifier.mockResolvedValue({ result: "CLIVEVERIFIER" })
		vaultMock.pending_changes.mockResolvedValue({ result: [] })
		tokenMock.pending_changes.mockResolvedValue({ result: [] })
		oracleMock.pending_changes.mockResolvedValue({ result: [] })
		linkTarget.contractId = addresses.async_vault
		linkTarget.expiresAt = new Date("2027-01-15T08:00:00Z")
		window.history.replaceState(null, "", "/sign")
	})

	it("replaces the hash and waits for the next signer below the threshold", async () => {
		accountSignersMock.mockResolvedValue(signers(3))
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() => expect(result.current.state).toBe("already-signed"))
		expect(walletSigns).toHaveBeenCalledWith(xdrSignedBy(first), {
			networkPassphrase,
			address: wallet,
		})
		expect(result.current.xdr).toBe(xdrSignedBy(first, wallet))
		expect(window.location.hash).toBe(`#${xdrSignedBy(first, wallet)}`)
		expect(result.current.signedBy).toEqual([first, wallet])
		expect(result.current.weight).toBe(2)
		expect(submitSignedMock).not.toHaveBeenCalled()
		expect(result.current.status).toEqual({ status: "idle" })
	})

	it("submits as soon as the signature reaches the threshold", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		submitSignedMock.mockResolvedValue({
			status: "success",
			hash: "abc123",
			result: undefined,
		})
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "confirmed",
				hash: "abc123",
				result: undefined,
			}),
		)
		const submitted = submitSignedMock.mock.calls[0]?.[0] as Transaction
		expect(marked(submitted).signedBy).toEqual([first, wallet])
		expect(window.location.hash).toBe(`#${xdrSignedBy(first, wallet)}`)
	})

	it("never asks for a signature once the threshold is met", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign(xdrSignedBy(first, third), wallet)
		await waitFor(() => expect(result.current.state).toBe("ready"))

		act(() => result.current.sign())

		expect(walletSigns).not.toHaveBeenCalled()
		expect(result.current.canSign).toBe(false)
		expect(result.current.canSubmit).toBe(true)
	})

	it("reports a network rejection on submit", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		submitSignedMock.mockResolvedValue({
			status: "failed",
			reason: "sequence-consumed",
			hash: "abc123",
		})
		const { result } = renderSign(xdrSignedBy(first, third), undefined)
		await waitFor(() => expect(result.current.canSubmit).toBe(true))

		act(() => result.current.submit())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "network", reason: "sequence-consumed" },
				hash: "abc123",
			}),
		)
	})

	it("reports a declined signature and offers nothing else", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		walletSigns.mockRejectedValueOnce({ code: -4, message: "User rejected" })
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "declined" },
			}),
		)
		expect(result.current.xdr).toBe(xdrSignedBy(first))
	})

	it("reports a wallet error as unsigned, not as a choice", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		walletSigns.mockRejectedValueOnce({ code: -1, message: "Internal error" })
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "unsigned" },
			}),
		)
		expect(result.current.xdr).toBe(xdrSignedBy(first))
	})

	it("treats a wallet that is not a signer as unable to sign", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign(xdrSignedBy(first), "GOUTSIDER")

		await waitFor(() => expect(result.current.state).toBe("not-signer"))
		expect(result.current.canSign).toBe(false)
	})

	it("detects a consumed sequence number", async () => {
		accountSignersMock.mockResolvedValue({ ...signers(2), sequence: "42" })
		transactionStatusMock.mockResolvedValue("not-found")
		const { result } = renderSign(xdrSignedBy(first), wallet)

		await waitFor(() =>
			expect(transactionStatusMock).toHaveBeenCalledWith("abc123"),
		)
		expect(result.current.state).toBe("consumed")
	})

	it("reports a consumed sequence whose transaction succeeded as executed", async () => {
		accountSignersMock.mockResolvedValue({ ...signers(2), sequence: "42" })
		transactionStatusMock.mockResolvedValue("success")
		const { result } = renderSign(xdrSignedBy(first, third), wallet)

		await waitFor(() => expect(result.current.state).toBe("executed"))
		expect(result.current.canSubmit).toBe(false)
	})

	it("keeps a consumed sequence whose transaction failed as consumed", async () => {
		accountSignersMock.mockResolvedValue({ ...signers(2), sequence: "42" })
		transactionStatusMock.mockResolvedValue("failed")
		const { result } = renderSign(xdrSignedBy(first, third), wallet)

		await waitFor(() => expect(transactionStatusMock).toHaveBeenCalled())
		expect(result.current.state).toBe("consumed")
	})

	it("never looks a transaction up while its sequence is live", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign(xdrSignedBy(first, third), wallet)

		await waitFor(() => expect(result.current.state).toBe("ready"))
		expect(transactionStatusMock).not.toHaveBeenCalled()
	})

	it("lands on executed after its own successful submit", async () => {
		accountSignersMock
			.mockResolvedValueOnce(signers(2))
			.mockResolvedValue({ ...signers(2), sequence: "42" })
		transactionStatusMock.mockResolvedValue("not-found")
		submitSignedMock.mockResolvedValue({
			status: "success",
			hash: "abc123",
			result: undefined,
		})
		const { result } = renderSign(xdrSignedBy(first, third), wallet)
		await waitFor(() => expect(result.current.canSubmit).toBe(true))

		act(() => result.current.submit())

		await waitFor(() => expect(result.current.state).toBe("executed"))
		expect(transactionStatusMock).not.toHaveBeenCalled()
	})

	it("keeps the router state when it replaces the hash", async () => {
		accountSignersMock.mockResolvedValue(signers(3))
		window.history.replaceState({ idx: 7 }, "", "/sign")
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() => expect(result.current.state).toBe("already-signed"))
		expect(window.history.state).toEqual({ idx: 7 })
	})

	it("reports unsigned when the wallet returns something that is not a transaction", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		walletSigns.mockResolvedValueOnce({ signedTxXdr: "garbage" })
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "unsigned" },
			}),
		)
		expect(result.current.xdr).toBe(xdrSignedBy(first))
		expect(submitSignedMock).not.toHaveBeenCalled()
	})

	it("reports unsigned when the wallet returns a different transaction", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		walletSigns.mockResolvedValueOnce({
			signedTxXdr: xdrSignedBy(first, wallet, "GTAMPERED"),
		})
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "unsigned" },
			}),
		)
		expect(result.current.xdr).toBe(xdrSignedBy(first))
		expect(submitSignedMock).not.toHaveBeenCalled()
	})

	it("reports unsigned when the wallet drops a previous signature", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		walletSigns.mockResolvedValueOnce({ signedTxXdr: xdrSignedBy(wallet) })
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "unsigned" },
			}),
		)
		expect(result.current.xdr).toBe(xdrSignedBy(first))
		expect(submitSignedMock).not.toHaveBeenCalled()
	})

	it("reports unknown when the submit path throws", async () => {
		accountSignersMock.mockResolvedValue(signers(2))
		submitSignedMock.mockRejectedValue(new TypeError("Failed to fetch"))
		const { result } = renderSign(xdrSignedBy(first, third), wallet)
		await waitFor(() => expect(result.current.canSubmit).toBe(true))

		act(() => result.current.submit())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "unknown" },
			}),
		)
	})

	it("reports unsigned when the wallet returns without its own signature", async () => {
		accountSignersMock.mockResolvedValue(signers(3))
		walletSigns.mockResolvedValueOnce({
			signedTxXdr: xdrSignedBy(first, third),
		})
		const { result } = renderSign(xdrSignedBy(first), wallet)
		await waitFor(() => expect(result.current.canSign).toBe(true))

		act(() => result.current.sign())

		await waitFor(() =>
			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "unsigned" },
			}),
		)
		expect(result.current.xdr).toBe(xdrSignedBy(first))
		expect(submitSignedMock).not.toHaveBeenCalled()
	})

	it("reports an expired link whose transaction succeeded as executed", async () => {
		linkTarget.expiresAt = new Date("2020-01-01T00:00:00Z")
		accountSignersMock.mockResolvedValue({ ...signers(2), sequence: "42" })
		transactionStatusMock.mockResolvedValue("success")
		const { result } = renderSign(xdrSignedBy(first, third), wallet)

		await waitFor(() => expect(result.current.state).toBe("executed"))
	})

	it("describes a link for the verifier the share token reports now", async () => {
		linkTarget.contractId = "CLIVEVERIFIER"
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign("xdr:allow:", wallet)

		await waitFor(() =>
			expect(result.current.description?.contract).toBe("Identity verifier"),
		)
	})

	it("falls back to the configured verifier when the live read fails", async () => {
		linkTarget.contractId = addresses.identity_verifier
		tokenMock.identity_verifier.mockRejectedValue(new Error("rpc down"))
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign("xdr:allow:", wallet)

		await waitFor(() =>
			expect(result.current.description?.contract).toBe("Identity verifier"),
		)
	})

	it("stays loading, not invalid, until the live verifier is read", async () => {
		linkTarget.contractId = "CLIVEVERIFIER"
		const { result } = renderSign("xdr:allow:", wallet)

		expect(result.current.loading).toBe(true)
		await waitFor(() => expect(result.current.loading).toBe(false))
	})

	it("reads nothing from an invalid link", () => {
		const { result } = renderSign("not-an-envelope", wallet)

		expect(result.current.pending).toBeNull()
		expect(result.current.description).toBeNull()
		expect(accountSignersMock).not.toHaveBeenCalled()
	})

	it("names the pending change an apply link acts on once the vault lists it", async () => {
		vaultMock.pending_changes.mockResolvedValue({
			result: [
				{ id: 3, change: { tag: "Notice", values: [43_200n] }, eta: 1n },
			],
		})
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign("xdr:apply_change:", wallet)

		await waitFor(() =>
			expect(result.current.description?.args).toEqual([
				{ label: "Change", value: "vault change #3: Notice 12h" },
			]),
		)
	})

	it("names the share-token change an apply link acts on from the token's list", async () => {
		linkTarget.contractId = addresses.share_token
		vaultMock.pending_changes.mockResolvedValue({
			result: [
				{ id: 3, change: { tag: "Notice", values: [43_200n] }, eta: 1n },
			],
		})
		tokenMock.pending_changes.mockResolvedValue({
			result: [
				{
					id: 3,
					change: { tag: "RevokeRole", values: ["manager", "GHOLDER"] },
					eta: 1n,
				},
			],
		})
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign("xdr:apply_change:", wallet)

		await waitFor(() =>
			expect(result.current.description).toMatchObject({
				contract: "Share token",
				action: "apply-token-change",
				args: [
					{
						label: "Change",
						value: "share token change #3: Revoke role manager from GHOLDER",
					},
				],
			}),
		)
	})

	it("names the oracle change an apply link acts on from the oracle's list", async () => {
		linkTarget.contractId = addresses.nav_oracle
		oracleMock.pending_changes.mockResolvedValue({
			result: [{ id: 3, change: { tag: "Admin", values: ["GNEXT"] }, eta: 1n }],
		})
		accountSignersMock.mockResolvedValue(signers(2))
		const { result } = renderSign("xdr:apply_change:", wallet)

		await waitFor(() =>
			expect(result.current.description).toMatchObject({
				contract: "Oracle",
				action: "apply-oracle-change",
				args: [
					{ label: "Change", value: "oracle change #3: Admin hand-over GNEXT" },
				],
			}),
		)
	})

	it("refuses an operation the console does not propose", async () => {
		const { result } = renderSign("xdr:request_deposit:", wallet)
		await waitFor(() => expect(result.current.loading).toBe(false))

		expect(result.current.pending).toBeNull()
	})
})

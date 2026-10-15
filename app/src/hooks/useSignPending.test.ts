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

const { accountSignersMock, submitSignedMock } = vi.hoisted(() => ({
	accountSignersMock: vi.fn(),
	submitSignedMock: vi.fn(),
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
): PendingTransaction => ({
	transaction: { signedBy } as unknown as Transaction,
	source: authority,
	sequence: "42",
	expiresAt: new Date("2027-01-15T08:00:00Z"),
	contractId: addresses.async_vault,
	fn,
	args,
	hash: "abc123",
})

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => {
	const actual = await importOriginal<typeof AppLib>()
	return {
		...actual,
		accountSigners: accountSignersMock,
		submitSigned: submitSignedMock,
		decodePending: (xdr: string) => {
			const match = /^xdr:([a-z_]+):(.*)$/.exec(xdr)
			if (match === null) {
				throw new actual.InvalidPendingTransaction("not a transaction envelope")
			}
			const [, fn = "", signed = ""] = match
			const args = fn === "set_custodian" ? ["GCUSTODIAN", "GAUTHORITY"] : []
			return pendingOf(fn, args, signed === "" ? [] : signed.split(","))
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
		const { result } = renderSign(xdrSignedBy(first), wallet)

		await waitFor(() => expect(result.current.state).toBe("consumed"))
	})

	it("reads nothing from an invalid link", () => {
		const { result } = renderSign("not-an-envelope", wallet)

		expect(result.current.pending).toBeNull()
		expect(result.current.description).toBeNull()
		expect(accountSignersMock).not.toHaveBeenCalled()
	})

	it("refuses an operation the console does not propose", () => {
		const { result } = renderSign("xdr:request_deposit:", wallet)

		expect(result.current.pending).toBeNull()
	})
})

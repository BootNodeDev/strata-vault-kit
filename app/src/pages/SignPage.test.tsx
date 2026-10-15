import { type Transaction } from "@stellar/stellar-sdk"
import type * as AppLib from "@stellar-scaffold/app-lib"
import {
	type AccountSigners,
	networkPassphrase,
	type PendingTransaction,
} from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { addresses } from "../config/addresses"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
import SignPage from "./SignPage"

const { accountSignersMock, submitSignedMock } = vi.hoisted(() => ({
	accountSignersMock: vi.fn(),
	submitSignedMock: vi.fn(),
}))

type Marker = { signedBy: string[] }

const marked = (transaction: Transaction): Marker =>
	transaction as unknown as Marker

const authority = "GAUTHORITYACCOUNT"
const first = "GFIRSTSIGNER"
const second = "GSECONDSIGNER"

const short = (key: string) => `${key.slice(0, 4)}...${key.slice(-4)}`

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => {
	const actual = await importOriginal<typeof AppLib>()
	return {
		...actual,
		accountSigners: accountSignersMock,
		submitSigned: submitSignedMock,
		decodePending: (xdr: string): PendingTransaction => {
			const match = /^xdr:(.*)$/.exec(xdr)
			if (match === null) {
				throw new actual.InvalidPendingTransaction("not a transaction envelope")
			}
			const signed = match[1] ?? ""
			return {
				transaction: {
					signedBy: signed === "" ? [] : signed.split(","),
				} as unknown as Transaction,
				source: authority,
				sequence: "42",
				expiresAt: new Date("2027-01-15T08:00:00Z"),
				contractId: addresses.async_vault,
				fn: "set_deposit_cap",
				args: [1_500_000_000n, authority],
				hash: "abc123",
			}
		},
		signatureWeight: (transaction: Transaction, signers: AccountSigners) => {
			const signedBy = marked(transaction).signedBy.filter((key) =>
				signers.signers.some((signer) => signer.key === key),
			)
			return { signedBy, weight: signedBy.length }
		},
		hasSigned: (transaction: Transaction, key: string) =>
			marked(transaction).signedBy.includes(key),
	}
})

const xdrSignedBy = (...keys: string[]) => `xdr:${keys.join(",")}`

const twoOfTwo: AccountSigners = {
	signers: [
		{ key: first, weight: 1 },
		{ key: second, weight: 1 },
	],
	thresholds: { low: 1, med: 2, high: 2 },
	sequence: "41",
}

const walletSigns = vi.fn(async (xdr: string) => ({
	signedTxXdr: `${xdr},${second}`,
}))

const renderSign = (hash: string, address: string | undefined) => {
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
	return render(
		<QueryClientProvider client={queryClient}>
			<WalletContext value={context}>
				<MemoryRouter initialEntries={[`/sign${hash}`]}>
					<Routes>
						<Route path="/sign" element={<SignPage />} />
					</Routes>
				</MemoryRouter>
			</WalletContext>
		</QueryClientProvider>,
	)
}

const button = (name: string) =>
	screen.getByRole("button", { name }) as HTMLButtonElement

describe("SignPage", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		accountSignersMock.mockResolvedValue(twoOfTwo)
		window.history.replaceState(null, "", "/sign")
	})

	it("tells the visitor when the link carries no transaction", () => {
		renderSign("#not-an-envelope", undefined)

		expect(
			screen.getByText("This link does not carry a valid transaction."),
		).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Sign" })).toBeNull()
	})

	it("shows the pending operation in the console's terms", async () => {
		renderSign(`#${xdrSignedBy(first)}`, second)

		expect(
			screen.getByRole("heading", { name: "Set the deposit cap" }),
		).toBeTruthy()
		expect(screen.getByText("Vault")).toBeTruthy()
		expect(screen.getByText("150.00")).toBeTruthy()
		expect(screen.getByText(short(authority))).toBeTruthy()
		expect(screen.getByText(short(addresses.async_vault))).toBeTruthy()
		expect(screen.getByText("15 Jan 2027")).toBeTruthy()
		expect(await screen.findByText("1 of 2 signatures")).toBeTruthy()
		expect(screen.getByText(short(first)).textContent).toContain("signed")
		expect(screen.getByText(short(second)).textContent).not.toContain("signed")
		expect(screen.getByRole("status").textContent).toBe(
			"Waiting for signatures.",
		)
		await waitFor(() => expect(button("Sign").disabled).toBe(false))
		expect(button("Submit").disabled).toBe(true)
		expect(
			(screen.getByLabelText("Signing link") as HTMLInputElement).value,
		).toContain(`/sign#${xdrSignedBy(first)}`)
	})

	it("asks a visitor without a wallet to connect one", async () => {
		renderSign(`#${xdrSignedBy(first)}`, undefined)

		await screen.findByText("1 of 2 signatures")
		expect(button("Connect a wallet to sign").disabled).toBe(true)
	})

	it("keeps a wallet that does not sign for the account out", async () => {
		renderSign(`#${xdrSignedBy(first)}`, "GOUTSIDER")

		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe(
				"Your wallet does not sign for this account.",
			),
		)
		expect(button("Sign").disabled).toBe(true)
	})

	it("lets anyone submit once the signatures are complete", async () => {
		renderSign(`#${xdrSignedBy(first, second)}`, undefined)

		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe(
				"Signatures complete. Anyone can submit.",
			),
		)
		expect(button("Submit").disabled).toBe(false)
		expect(screen.getByText("2 of 2 signatures")).toBeTruthy()
	})

	it("signs, updates the link and submits at the threshold", async () => {
		submitSignedMock.mockResolvedValue({
			status: "success",
			hash: "abc123",
			result: undefined,
		})
		renderSign(`#${xdrSignedBy(first)}`, second)
		await waitFor(() => expect(button("Sign").disabled).toBe(false))

		fireEvent.click(button("Sign"))

		expect(await screen.findByText("Deposit cap updated")).toBeTruthy()
		expect(screen.getByText("Deposit cap: 150.00.")).toBeTruthy()
		const link = screen.getByLabelText("Signing link") as HTMLInputElement
		expect(link.value).toContain(`/sign#${xdrSignedBy(first, second)}`)
		expect(window.location.hash).toBe(`#${xdrSignedBy(first, second)}`)
	})

	it("explains a network rejection through the modal", async () => {
		submitSignedMock.mockResolvedValue({
			status: "failed",
			reason: "sequence-consumed",
			hash: "abc123",
		})
		renderSign(`#${xdrSignedBy(first, second)}`, undefined)
		await waitFor(() => expect(button("Submit").disabled).toBe(false))

		fireEvent.click(button("Submit"))

		expect(await screen.findByText("The network rejected it")).toBeTruthy()
		expect(
			screen.getByText(
				"The account moved on; this transaction is no longer valid.",
			),
		).toBeTruthy()
	})
})

import { type Transaction } from "@stellar/stellar-sdk"
import type * as AppLib from "@stellar-scaffold/app-lib"
import {
	type AccountSigners,
	networkPassphrase,
	type PendingTransaction,
} from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { addresses } from "../config/addresses"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
import SignPage from "./SignPage"

const { accountSignersMock, submitSignedMock, transactionStatusMock } =
	vi.hoisted(() => ({
		accountSignersMock: vi.fn(),
		submitSignedMock: vi.fn(),
		transactionStatusMock: vi.fn(),
	}))

const tokenAdmin = "GTOKENADMINACCOUNT"

vi.mock("../config/clients", () => ({
	shareToken: async () => ({
		identity_verifier: async () => ({ result: "CLIVEVERIFIER" }),
		get_admin: async () => ({ result: tokenAdmin }),
	}),
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
		transactionStatus: transactionStatusMock,
		decodePending: (xdr: string): PendingTransaction => {
			if (xdr === "xdr:transfer")
				return {
					transaction: { signedBy: [] } as unknown as Transaction,
					source: authority,
					sequence: "42",
					expiresAt: new Date("2027-01-15T08:00:00Z"),
					contractId: addresses.share_token,
					fn: "legal_transfer",
					args: [first, second, 25_000_000n, "ORDER-1", authority],
					hash: "abc123",
					authorization: {
						address: tokenAdmin,
						signed: false,
						expirationLedger: 0,
					},
				}
			const match = /^xdr:([^;]*)(;expired)?$/.exec(xdr)
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
				expiresAt:
					match[2] === undefined
						? new Date("2027-01-15T08:00:00Z")
						: new Date("2020-01-01T00:00:00Z"),
				contractId: addresses.async_vault,
				fn: "set_deposit_cap",
				args: [1_500_000_000n, authority],
				hash: "abc123",
				authorization: null,
			}
		},
		signatureWeight: (transaction: Transaction, signers: AccountSigners) => {
			const signing = signers.signers.filter(({ key }) =>
				marked(transaction).signedBy.includes(key),
			)
			return {
				signedBy: signing.map(({ key }) => key),
				weight: signing.reduce((total, { weight }) => total + weight, 0),
			}
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

const weighted: AccountSigners = {
	signers: [
		{ key: first, weight: 2 },
		{ key: second, weight: 1 },
	],
	thresholds: { low: 1, med: 3, high: 3 },
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
		signAuthEntry: vi.fn() as unknown as WalletContextType["signAuthEntry"],
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

const noButton = (name: string) =>
	expect(screen.queryByRole("button", { name })).toBeNull()

const status = () => screen.getByRole("status")

const progress = () => screen.getByRole("progressbar")

const signerRow = (key: string) => {
	const row = screen.getByText(short(key)).closest("li")
	if (row === null) throw new Error(`no row for ${key}`)
	return within(row)
}

describe("SignPage", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		accountSignersMock.mockResolvedValue(twoOfTwo)
		window.history.replaceState(null, "", "/sign")
	})

	it("tells the visitor when the link carries no transaction", async () => {
		renderSign("#not-an-envelope", undefined)

		expect(
			await screen.findByText("This link does not carry a valid transaction."),
		).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Sign" })).toBeNull()
	})

	it("shows the pending operation in the console's terms", async () => {
		renderSign(`#${xdrSignedBy(first)}`, second)

		expect(
			await screen.findByRole("heading", { name: "Set the deposit cap" }),
		).toBeTruthy()
		expect(screen.getByText("Vault")).toBeTruthy()
		expect(screen.getByText("150.00")).toBeTruthy()
		expect(screen.getByText(short(authority))).toBeTruthy()
		expect(screen.getByText(short(addresses.async_vault))).toBeTruthy()
		expect(screen.getByText("15 Jan 2027, 08:00 UTC")).toBeTruthy()
		expect(await screen.findByText("1 of 2 signatures")).toBeTruthy()
		expect(progress().getAttribute("aria-valuenow")).toBe("1")
		expect(progress().getAttribute("aria-valuemax")).toBe("2")
		expect(progress().children).toHaveLength(2)
		expect(signerRow(first).getByText("signed")).toBeTruthy()
		expect(signerRow(second).getByText("pending")).toBeTruthy()
		expect(signerRow(second).getByText("you")).toBeTruthy()
		expect(signerRow(first).queryByText("you")).toBeNull()
		expect(screen.queryByText(/^weight \d$/)).toBeNull()
		expect(status().textContent).toBe("Waiting for signatures")
		expect(status().getAttribute("aria-label")).toBe("Waiting for signatures.")
		await waitFor(() => expect(button("Sign").disabled).toBe(false))
		noButton("Submit")
		noButton("Connect a wallet to sign")
		expect(
			screen.getByText("Share the link with the next signer."),
		).toBeTruthy()
		expect(
			(screen.getByLabelText("Signing link") as HTMLInputElement).value,
		).toContain(`/sign#${xdrSignedBy(first)}`)
	})

	it("fills the bar by weight and labels signers that weigh differently", async () => {
		accountSignersMock.mockResolvedValue(weighted)
		renderSign(`#${xdrSignedBy(first)}`, second)

		expect(await screen.findByText("weight 2 of threshold 3")).toBeTruthy()
		expect(progress().getAttribute("aria-valuenow")).toBe("2")
		expect(progress().getAttribute("aria-valuemax")).toBe("3")
		expect(progress().children).toHaveLength(3)
		expect(signerRow(first).getByText("weight 2")).toBeTruthy()
		expect(signerRow(second).getByText("weight 1")).toBeTruthy()
	})

	it("asks a visitor without a wallet to connect one", async () => {
		renderSign(`#${xdrSignedBy(first)}`, undefined)

		await screen.findByText("1 of 2 signatures")
		expect(button("Connect a wallet to sign").disabled).toBe(true)
		noButton("Sign")
		noButton("Submit")
	})

	it("keeps a wallet that does not sign for the account out", async () => {
		renderSign(`#${xdrSignedBy(first)}`, "GOUTSIDER")

		await waitFor(() => expect(status().textContent).toBe("Not a signer"))
		expect(status().getAttribute("aria-label")).toBe(
			"Your wallet does not sign for this account.",
		)
		noButton("Sign")
		noButton("Submit")
		expect(
			screen.getByText("Only a signer of this account can sign."),
		).toBeTruthy()
		expect(screen.getByLabelText("Signing link")).toBeTruthy()
	})

	it("tells a signer who already signed to pass the link on", async () => {
		renderSign(`#${xdrSignedBy(first)}`, first)

		await screen.findByText("1 of 2 signatures")
		expect(status().textContent).toBe("You already signed")
		expect(signerRow(first).getByText("you")).toBeTruthy()
		expect(signerRow(first).getByText("signed")).toBeTruthy()
		noButton("Sign")
		noButton("Submit")
		expect(
			screen.getByText("Share the link with the next signer."),
		).toBeTruthy()
	})

	it("lets anyone submit once the signatures are complete", async () => {
		renderSign(`#${xdrSignedBy(first, second)}`, undefined)

		await waitFor(() => expect(status().textContent).toBe("Ready to submit"))
		expect(status().getAttribute("aria-label")).toBe(
			"Signatures complete. Anyone can submit.",
		)
		expect(button("Submit").disabled).toBe(false)
		noButton("Sign")
		noButton("Connect a wallet to sign")
		expect(screen.getByText("2 of 2 signatures")).toBeTruthy()
		expect(progress().getAttribute("aria-valuenow")).toBe("2")
		expect(screen.getByText("Anyone can submit this transaction.")).toBeTruthy()
	})

	it("sends an expired link back to the proposer without a share row", async () => {
		renderSign(`#${xdrSignedBy(first)};expired`, second)

		await waitFor(() => expect(status().textContent).toBe("Expired"))
		expect(status().textContent).toBe("Expired")
		expect(status().getAttribute("aria-label")).toBe(
			"This transaction expired.",
		)
		noButton("Sign")
		noButton("Submit")
		noButton("Connect a wallet to sign")
		expect(screen.getByText("Ask the proposer for a new link.")).toBeTruthy()
		expect(screen.queryByLabelText("Signing link")).toBeNull()
	})

	it("shows a transaction that already went through as executed", async () => {
		accountSignersMock.mockResolvedValue({ ...twoOfTwo, sequence: "42" })
		transactionStatusMock.mockResolvedValue("success")
		renderSign(`#${xdrSignedBy(first, second)}`, second)

		await waitFor(() => expect(status().textContent).toBe("Executed"))
		expect(status().getAttribute("aria-label")).toBe(
			"This transaction was already submitted.",
		)
		noButton("Sign")
		noButton("Submit")
		expect(screen.queryByText("Next step")).toBeNull()
		expect(screen.queryByLabelText("Signing link")).toBeNull()
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

	it("asks the token admin to authorize a legal transfer before anyone signs", async () => {
		renderSign("#xdr:transfer", tokenAdmin)

		expect(
			await screen.findByRole("heading", { name: "Make a legal transfer" }),
		).toBeTruthy()
		expect(screen.getByText("ORDER-1")).toBeTruthy()
		expect(screen.getByText(short(tokenAdmin))).toBeTruthy()
		expect(screen.getByText("Pending")).toBeTruthy()
		expect(status().textContent).toBe("Awaiting the admin's authorization")
		await waitFor(() => expect(button("Authorize").disabled).toBe(false))
		noButton("Sign")
		expect(
			screen.getByText(
				"The token admin authorizes first. Then compliance's signers sign.",
			),
		).toBeTruthy()
	})

	it("keeps Authorize disabled for a wallet that is not the token admin", async () => {
		renderSign("#xdr:transfer", second)

		expect(
			await screen.findByRole("heading", { name: "Make a legal transfer" }),
		).toBeTruthy()
		await waitFor(() => expect(button("Authorize").disabled).toBe(true))
	})
})

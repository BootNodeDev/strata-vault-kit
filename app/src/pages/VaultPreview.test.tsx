import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import {
	formatDate,
	formatScaled,
	networkPassphrase,
	PRICE_DECIMALS,
	type Price,
	shortAddress,
} from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type AddressRow } from "../components/vault/AboutVault"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"
import VaultPreview from "./VaultPreview"

const {
	mockVaultId,
	mockGovernanceAddress,
	mockShares,
	mockDeposit,
	mockSymbols,
	mockRequests,
	requestDepositMock,
} = vi.hoisted(() => ({
	mockVaultId: "CMOCKVAULTADDRESS1234567890",
	mockGovernanceAddress: "GGOVERNANCEADDRESS1234567890",
	mockShares: { balance: 500_0000000n },
	mockDeposit: { balance: 3200_0000000n },
	mockSymbols: {
		token: "USDC",
		shareToken: "vUSDC",
		vaultName: "Strata Vault",
	},
	mockRequests: {
		readable: true,
		currentEpoch: 2n,
		epochs: new Map<bigint, { status: { tag: string }; share_price: bigint }>([
			[
				1n,
				{ status: { tag: "Fulfilled" }, share_price: 1_000000000000000000n },
			],
			[2n, { status: { tag: "Open" }, share_price: 0n }],
		]),
		deposits: new Map<
			bigint,
			{ amount: bigint; claimed: boolean } | undefined
		>(),
		redeems: new Map<
			bigint,
			{ shares: bigint; claimed: boolean } | undefined
		>(),
	},
	requestDepositMock: vi.fn(),
}))

const defaultRequestDepositImpl = async ({
	amount,
}: {
	from: string
	amount: bigint
}) => {
	const epochId = mockRequests.currentEpoch
	return {
		simulation: undefined,
		signAndSend: async ({
			watcher,
		}: {
			watcher: { onSubmitted: () => void }
		}) => {
			watcher.onSubmitted()
			mockRequests.deposits.set(epochId, { amount, claimed: false })
			return { getTransactionResponse: { status: "SUCCESS" }, result: epochId }
		},
	}
}

const resetMockRequests = () => {
	mockRequests.readable = true
	mockRequests.currentEpoch = 2n
	mockRequests.deposits.clear()
	mockRequests.redeems.clear()
	requestDepositMock.mockReset()
	requestDepositMock.mockImplementation(defaultRequestDepositImpl)
}

beforeEach(() => {
	mockShares.balance = 500_0000000n
	mockDeposit.balance = 3200_0000000n
	resetMockRequests()
})

afterEach(() => {
	mockShares.balance = 500_0000000n
	mockDeposit.balance = 3200_0000000n
	resetMockRequests()
})

const price = 1500000000000000000n as Price
const attestedAt = 1757900000n

vi.mock("../config/contracts", () => {
	const contractRows: AddressRow[] = [{ label: "Vault", address: mockVaultId }]
	return { vaultContractId: mockVaultId, contractRows }
})

vi.mock("../config/clients", () => {
	const figure = (result: bigint) => async () => ({ result })
	const address = (result: string | undefined) => async () => ({ result })
	const vault = {
		liquid_reserve: figure(184000000000n),
		committed: figure(62000000000n),
		uncovered: figure(0n),
		total_economic_supply: figure(100000000000000n),
		net_deployed: figure(50000000000n),
		governance: address(mockGovernanceAddress),
		manager: address(undefined),
		treasury: address(undefined),
		guardian: address(undefined),
		custodian: address(undefined),
		current_epoch: async () => {
			if (!mockRequests.readable) throw new Error("boom")
			return { result: mockRequests.currentEpoch }
		},
		get_epoch: async ({ epoch_id }: { epoch_id: bigint }) => ({
			result: mockRequests.epochs.get(epoch_id),
		}),
		get_deposit_request: async ({ epoch_id }: { epoch_id: bigint }) => ({
			result: mockRequests.deposits.get(epoch_id),
		}),
		get_redeem_request: async ({ epoch_id }: { epoch_id: bigint }) => ({
			result: mockRequests.redeems.get(epoch_id),
		}),
		request_deposit: requestDepositMock,
	}
	const oracle = {
		state: async () => ({ result: { tag: "Valid", values: undefined } }),
		latest: async () => ({
			result: {
				nav_per_share: 1500000000000000000n,
				expires_at: 1800000000n,
				timestamp: 1757900000n,
			},
		}),
	}
	const identity = { is_allowed: async () => ({ result: true }) }
	const shares = {
		balance: async () => ({ result: mockShares.balance }),
		symbol: async () => ({ result: mockSymbols.shareToken }),
		name: async () => ({ result: mockSymbols.vaultName }),
	}
	const depositAsset = {
		symbol: async () => ({ result: mockSymbols.token }),
		balance: async () => ({ result: mockDeposit.balance }),
	}

	return {
		asyncVault: async () => vault,
		asyncVaultWriter: async () => vault,
		navOracle: async () => oracle,
		identityVerifier: async () => identity,
		shareToken: async () => shares,
		asset: async () => depositAsset,
	}
})

const investorAddress = "GINVESTORADDRESS1234567890"

const connectedWallet: WalletContextType = {
	address: investorAddress,
	networkPassphrase,
	balances: {},
	isPending: false,
	updateBalances: async () => {},
	signTransaction: vi.fn() as WalletContextType["signTransaction"],
}

const wrongNetworkWallet: WalletContextType = {
	...connectedWallet,
	networkPassphrase: "different-passphrase",
}

const renderVaultPreview = (
	wallet?: WalletContextType,
): ReturnType<typeof render> => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
		wallet ? (
			<QueryClientProvider client={queryClient}>
				<WalletContext value={wallet}>{children}</WalletContext>
			</QueryClientProvider>
		) : (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		)
	return render(<VaultPreview />, { wrapper })
}

describe("VaultPreview", () => {
	it("renders the action panel in the side column", () => {
		renderVaultPreview()

		const side = screen.getByRole("complementary", { name: "Actions" })
		expect(
			screen.getByRole("heading", { name: "Request a subscription" }),
		).toBeTruthy()
		expect(side.childElementCount).toBeGreaterThan(0)
	})

	it("renders the header and the Vault row from the same configured address", () => {
		renderVaultPreview()

		expect(screen.getAllByText(shortAddress(mockVaultId))).toHaveLength(2)
	})

	it("shows no fabricated requests, position, or balance while disconnected", () => {
		renderVaultPreview()

		expect(screen.getByRole("tab", { name: "Ready to claim 0" })).toBeTruthy()
		expect(screen.getByRole("tab", { name: "Waiting 0" })).toBeTruthy()
		expect(screen.getByRole("tab", { name: "Not claimable 0" })).toBeTruthy()
		expect(
			screen.getByText("Connect a wallet to see your position."),
		).toBeTruthy()
		expect(screen.queryByText("1,000.00 vTOKEN")).toBeNull()
		expect(screen.queryByText("Operator vault name")).toBeNull()
		expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeTruthy()
	})

	it("shows a checking message before the investor's requests resolve", () => {
		renderVaultPreview(connectedWallet)

		expect(screen.getByText("Checking your requests.")).toBeTruthy()
	})

	it("shows the loaded empty message once a connected investor has no pending requests", async () => {
		renderVaultPreview(connectedWallet)

		expect(
			await screen.findByText(
				"Nothing to claim yet. A request appears here once it is priced, and for cash, once the reserve covers it in full.",
			),
		).toBeTruthy()
	})

	it("renders a connected investor's live request under Waiting", async () => {
		mockRequests.redeems.set(2n, { shares: 1000_0000000n, claimed: false })
		renderVaultPreview(connectedWallet)

		fireEvent.click(await screen.findByRole("tab", { name: /^Waiting/ }))

		expect(await screen.findByText("Redemption")).toBeTruthy()
		expect(screen.getByText("1,000.00 vUSDC")).toBeTruthy()
		expect(screen.getByRole("tab", { name: "Waiting 1" })).toBeTruthy()
	})

	it("shows a failed request read distinctly from a genuine empty one", async () => {
		mockRequests.readable = false
		renderVaultPreview(connectedWallet)

		expect(
			await screen.findByText(
				"Could not read your requests. Try again shortly.",
			),
		).toBeTruthy()
		expect(
			screen.queryByText(
				"Nothing to claim yet. A request appears here once it is priced, and for cash, once the reserve covers it in full.",
			),
		).toBeNull()
	})

	it("clears an open tooltip when another tab is clicked", async () => {
		mockRequests.currentEpoch = 3n
		mockRequests.epochs.set(3n, {
			status: { tag: "Fulfilled" },
			share_price: 0n,
		})
		mockRequests.deposits.set(3n, { amount: 500_0000000n, claimed: false })
		renderVaultPreview(connectedWallet)

		fireEvent.click(await screen.findByRole("tab", { name: "Not claimable 1" }))
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Why you cannot claim this yet",
			}),
		)
		expect(screen.getByRole("tooltip")).toBeTruthy()

		fireEvent.click(screen.getByRole("tab", { name: "Ready to claim 0" }))
		fireEvent.click(screen.getByRole("tab", { name: "Not claimable 1" }))

		expect(screen.queryByRole("tooltip")).toBeNull()
	})

	it("clears an open tooltip when another tab is selected with the keyboard", async () => {
		mockRequests.currentEpoch = 3n
		mockRequests.epochs.set(3n, {
			status: { tag: "Fulfilled" },
			share_price: 0n,
		})
		mockRequests.deposits.set(3n, { amount: 500_0000000n, claimed: false })
		renderVaultPreview(connectedWallet)

		const blockedTab = await screen.findByRole("tab", {
			name: "Not claimable 1",
		})
		fireEvent.click(blockedTab)
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Why you cannot claim this yet",
			}),
		)
		expect(screen.getByRole("tooltip")).toBeTruthy()

		fireEvent.keyDown(blockedTab, { key: "Home" })
		const readyTab = screen.getByRole("tab", { name: "Ready to claim 0" })
		fireEvent.keyDown(readyTab, { key: "End" })

		expect(screen.queryByRole("tooltip")).toBeNull()
	})

	it("renders the vault name read from the share token's own contract, not a fabricated one", async () => {
		renderVaultPreview()

		expect(
			await screen.findByRole("heading", { name: mockSymbols.vaultName }),
		).toBeTruthy()
	})

	it("reaches subscribe once connected, allowlisted, on the right network and priced", async () => {
		renderVaultPreview(connectedWallet)

		expect(
			await screen.findByRole("button", { name: "Subscribe" }),
		).toBeTruthy()
	})

	it("reads and renders the connected address's share balance, using the share token's own reported symbol", async () => {
		renderVaultPreview(connectedWallet)

		expect(await screen.findByText("500.00 vUSDC")).toBeTruthy()
	})

	it("renders a genuine zero balance as a formatted zero, not the absence indicator", async () => {
		mockShares.balance = 0n
		renderVaultPreview(connectedWallet)

		expect(await screen.findByText("0.00 vUSDC")).toBeTruthy()
		expect(screen.queryByText("—")).toBeNull()
	})

	it("reads and renders the connected address's deposit asset balance for the subscribe side", async () => {
		renderVaultPreview(connectedWallet)

		expect(await screen.findByText("Balance 3,200.00")).toBeTruthy()
	})

	it("reads and renders the connected address's share balance for the redeem side", async () => {
		renderVaultPreview(connectedWallet)

		fireEvent.click(await screen.findByRole("tab", { name: "Redeem" }))

		expect(await screen.findByText("Balance 500.00")).toBeTruthy()
	})

	it("computes the subscribe estimate from the oracle's own attested price, not a fabricated one", async () => {
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})

		fireEvent.change(input, { target: { value: "150" } })

		expect(await screen.findByText("≈ 100.00 vUSDC")).toBeTruthy()
	})

	it("shows a switch-network control, distinct from connect, when the wallet is on the wrong network", async () => {
		renderVaultPreview(wrongNetworkWallet)

		expect(
			await screen.findByRole("button", { name: /Switch to/ }),
		).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Connect Wallet" })).toBeNull()
	})

	it("states one of the four batch-settlement rules in the vault explainer", () => {
		renderVaultPreview()

		expect(screen.getByText(/one request per side per batch/i)).toBeTruthy()
	})

	it("renders the liquidity figures the vault reports, scaled and grouped", async () => {
		renderVaultPreview()

		expect(await screen.findByText("18,400.00")).toBeTruthy()
		expect(screen.getByText("6,200.00")).toBeTruthy()
		expect(screen.getByText("0.00")).toBeTruthy()
	})

	it("renders the vault size figures in the explainer", async () => {
		renderVaultPreview()

		expect(await screen.findByText("10,000,000.00")).toBeTruthy()
		expect(screen.getByText("5,000.00")).toBeTruthy()
	})

	it("renders the authority addresses the vault reports, or unavailable when unset", async () => {
		renderVaultPreview()

		expect(
			await screen.findByText(shortAddress(mockGovernanceAddress)),
		).toBeTruthy()
		expect(screen.getAllByText("Unavailable")).toHaveLength(4)
	})

	it("renders the share price the oracle attests once the NAV classifies as valid", async () => {
		renderVaultPreview()

		expect(
			await screen.findByText(formatScaled(price, PRICE_DECIMALS, 4)),
		).toBeTruthy()
		expect(screen.getByText(`Attested ${formatDate(attestedAt)}`)).toBeTruthy()
	})

	it("reaches the vault with the amount the investor entered when Subscribe is pressed", async () => {
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})
		fireEvent.change(input, { target: { value: "150" } })

		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		await waitFor(() => expect(requestDepositMock).toHaveBeenCalledTimes(1))
		expect(requestDepositMock).toHaveBeenCalledWith({
			from: investorAddress,
			amount: 150_0000000n,
		})
	})

	it("reflects a confirmed subscription in the request list without a manual refresh", async () => {
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})
		fireEvent.change(input, { target: { value: "150" } })

		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", { name: "Request locked in" }),
		).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Close" }))

		fireEvent.click(await screen.findByRole("tab", { name: /^Waiting/ }))
		expect(await screen.findByText("Subscription")).toBeTruthy()
		expect(screen.getByText("150.00 USDC")).toBeTruthy()
	})

	it("opens the modal before the wallet is ever asked to sign, so the Subscribe button cannot be pressed again", async () => {
		requestDepositMock.mockImplementationOnce(() => new Promise(() => {}))
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})
		fireEvent.change(input, { target: { value: "150" } })
		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", { name: "Preparing your request" }),
		).toBeTruthy()
	})

	it("does not cancel anything when the modal is dismissed mid-flight, and the request still confirms", async () => {
		let resolveSend!: () => void
		const gate = new Promise<void>((resolve) => {
			resolveSend = resolve
		})
		requestDepositMock.mockImplementationOnce(
			async ({ amount }: { from: string; amount: bigint }) => ({
				simulation: undefined,
				signAndSend: async ({
					watcher,
				}: {
					watcher: { onSubmitted: () => void }
				}) => {
					watcher.onSubmitted()
					await gate
					mockRequests.deposits.set(mockRequests.currentEpoch, {
						amount,
						claimed: false,
					})
					return {
						getTransactionResponse: { status: "SUCCESS" },
						result: mockRequests.currentEpoch,
					}
				},
			}),
		)
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})
		fireEvent.change(input, { target: { value: "150" } })
		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", { name: "Sending your request" }),
		).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(screen.queryByRole("dialog")).toBeNull()

		resolveSend()

		fireEvent.click(await screen.findByRole("tab", { name: /^Waiting/ }))
		expect(await screen.findByText("Subscription")).toBeTruthy()
		expect(screen.getByText("150.00 USDC")).toBeTruthy()
		expect(requestDepositMock).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole("dialog")).toBeNull()
	})

	it("reconnects to a still-settling submission instead of leaving Subscribe dead after a mid-flight dismissal", async () => {
		let resolveSend!: () => void
		const gate = new Promise<void>((resolve) => {
			resolveSend = resolve
		})
		requestDepositMock.mockImplementationOnce(
			async ({ amount }: { from: string; amount: bigint }) => ({
				simulation: undefined,
				signAndSend: async ({
					watcher,
				}: {
					watcher: { onSubmitted: () => void }
				}) => {
					watcher.onSubmitted()
					await gate
					mockRequests.deposits.set(mockRequests.currentEpoch, {
						amount,
						claimed: false,
					})
					return {
						getTransactionResponse: { status: "SUCCESS" },
						result: mockRequests.currentEpoch,
					}
				},
			}),
		)
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})
		fireEvent.change(input, { target: { value: "150" } })
		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", { name: "Sending your request" }),
		).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(screen.queryByRole("dialog")).toBeNull()

		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", { name: "Sending your request" }),
		).toBeTruthy()
		expect(requestDepositMock).toHaveBeenCalledTimes(1)

		resolveSend()

		expect(
			await screen.findByRole("heading", { name: "Request locked in" }),
		).toBeTruthy()
	})

	it("retries with the amount actually submitted, not a since-edited field", async () => {
		requestDepositMock.mockImplementationOnce(async () => ({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		}))
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})
		fireEvent.change(input, { target: { value: "150" } })
		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", { name: "You declined the request" }),
		).toBeTruthy()

		fireEvent.change(input, { target: { value: "999" } })
		fireEvent.click(screen.getByRole("button", { name: "Try again" }))

		await waitFor(() => expect(requestDepositMock).toHaveBeenCalledTimes(2))
		expect(requestDepositMock).toHaveBeenLastCalledWith({
			from: investorAddress,
			amount: 150_0000000n,
		})
	})

	it("clears the amount field once the subscription confirms, so a second press cannot duplicate it", async () => {
		renderVaultPreview(connectedWallet)
		const input = (await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})) as HTMLInputElement
		fireEvent.change(input, { target: { value: "150" } })

		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", { name: "Request locked in" }),
		).toBeTruthy()
		expect(input.value).toBe("")
	})

	it("reads a declined signature as a choice and offers to try again", async () => {
		requestDepositMock.mockImplementationOnce(async () => ({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockRejectedValue(
					new AssembledTransaction.Errors.UserRejected("User declined access"),
				),
		}))
		renderVaultPreview(connectedWallet)
		const input = await screen.findByRole("textbox", {
			name: "Amount to subscribe",
		})
		fireEvent.change(input, { target: { value: "150" } })

		fireEvent.click(await screen.findByRole("button", { name: "Subscribe" }))

		expect(
			await screen.findByRole("heading", {
				name: "You declined the request",
			}),
		).toBeTruthy()
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
	})
})

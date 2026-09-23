import {
	formatDate,
	formatScaled,
	networkPassphrase,
	PRICE_DECIMALS,
	type Price,
	shortAddress,
} from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
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
}))

beforeEach(() => {
	mockShares.balance = 500_0000000n
	mockDeposit.balance = 3200_0000000n
})

afterEach(() => {
	mockShares.balance = 500_0000000n
	mockDeposit.balance = 3200_0000000n
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
		expect(
			screen.getByText("Connect a wallet to see your position."),
		).toBeTruthy()
		expect(screen.queryByText("1,000.00 vTOKEN")).toBeNull()
		expect(screen.queryByText("Operator vault name")).toBeNull()
		expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeTruthy()
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
})

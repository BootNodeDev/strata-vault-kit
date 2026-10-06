import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import App from "./App"
import type * as UseAdminAuthority from "./hooks/useAdminAuthority"
import { type AdminAuthority } from "./hooks/useAdminAuthority"
import { NotificationProvider } from "./providers/NotificationProvider"
import {
	WalletContext,
	type WalletContextType,
} from "./providers/WalletProvider"

const { useAdminAuthorityMock } = vi.hoisted(() => ({
	useAdminAuthorityMock: vi.fn(),
}))

vi.mock("./hooks/useAdminAuthority", async (importOriginal) => {
	const actual = await importOriginal<typeof UseAdminAuthority>()
	return { ...actual, useAdminAuthority: useAdminAuthorityMock }
})

const disconnectedWallet: WalletContextType = {
	address: undefined,
	networkPassphrase: undefined,
	balances: {},
	isPending: false,
	updateBalances: async () => {},
	signTransaction: vi.fn() as WalletContextType["signTransaction"],
}

const disconnectedAuthority: AdminAuthority = {
	status: "disconnected",
	surfaces: new Set(),
	grantedBy: {
		cycle: [],
		compliance: [],
		emergency: [],
		configuration: [],
		governance: [],
	},
	roles: [],
	addresses: { oracle: null, shareToken: null, identityVerifier: null },
}

const renderAt = (path: string) => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<WalletContext value={disconnectedWallet}>
				<NotificationProvider>
					<MemoryRouter initialEntries={[path]}>
						<App />
					</MemoryRouter>
				</NotificationProvider>
			</WalletContext>
		</QueryClientProvider>,
	)
}

describe("App", () => {
	it("renders the admin panel inside the app layout at /admin", () => {
		useAdminAuthorityMock.mockReturnValue(disconnectedAuthority)
		renderAt("/admin")

		expect(screen.getByText("Strata Vault Kit")).toBeTruthy()
		expect(
			screen.getByText("Connect a wallet to operate this vault."),
		).toBeTruthy()
		expect(screen.getByText("GitHub")).toBeTruthy()
	})
})

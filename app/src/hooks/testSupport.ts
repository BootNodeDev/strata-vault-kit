import { xdr } from "@stellar/stellar-sdk"
import { networkPassphrase } from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { vi } from "vitest"
import {
	WalletContext,
	type WalletContextType,
} from "../providers/WalletProvider"

export const investorAddress = "GINVESTORADDRESS1234567890"

const wallet: WalletContextType = {
	address: investorAddress,
	networkPassphrase,
	balances: {},
	isPending: false,
	updateBalances: async () => {},
	signTransaction: vi.fn() as WalletContextType["signTransaction"],
	signAuthEntry: vi.fn() as WalletContextType["signAuthEntry"],
}

export const renderWithWallet = <T>(useHook: () => T) => {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(WalletContext, { value: wallet }, children),
		)
	return { ...renderHook(useHook, { wrapper }), queryClient }
}

export const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

export const contractEvent = (name: string, data: xdr.ScVal) =>
	new xdr.ContractEvent({
		ext: new xdr.ExtensionPoint(0),
		contractId: null,
		type: xdr.ContractEventType.contract(),
		body: new xdr.ContractEventBody(
			0,
			new xdr.ContractEventV0({
				topics: [xdr.ScVal.scvSymbol(name)],
				data,
			}),
		),
	})

export const succeededWith = <T>(result: T, events: xdr.ContractEvent[]) => ({
	getTransactionResponse: {
		status: "SUCCESS",
		events: { transactionEventsXdr: [], contractEventsXdr: [events] },
	},
	result,
})

import { type ContractRead } from "@stellar-scaffold/app-lib"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	classifyPause,
	PAUSE_REFRESH_MS,
	useVaultPaused,
} from "./useVaultPaused"

const { pausedMock } = vi.hoisted(() => ({
	pausedMock: vi.fn(async () => ({ result: false })),
}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => ({ paused: pausedMock }),
}))

const setPageVisibility = (state: DocumentVisibilityState) => {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => state,
	})
	document.dispatchEvent(new Event("visibilitychange"))
}

const paused: ContractRead<boolean> = { kind: "value", value: true }
const open: ContractRead<boolean> = { kind: "value", value: false }
const contractError: ContractRead<boolean> = {
	kind: "contract-error",
	code: 1,
}
const unreadable: ContractRead<boolean> = { kind: "unreadable" }

describe("classifyPause", () => {
	it.each<[string, ContractRead<boolean>, string]>([
		["a value of true", paused, "paused"],
		["a value of false", open, "open"],
		["a contract error, never as open", contractError, "unreadable"],
		["an unreadable read", unreadable, "unreadable"],
	])("classifies %s as %s", (_name, read, expected) => {
		expect(classifyPause(read)).toBe(expected)
	})
})

describe("useVaultPaused", () => {
	afterEach(() => {
		setPageVisibility("visible")
		vi.useRealTimers()
	})

	it("stops polling while the browser tab is hidden and resumes once shown", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const client = new QueryClient({
			defaultOptions: {
				queries: { refetchOnWindowFocus: false, retry: false },
			},
		})
		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(QueryClientProvider, { client }, children)
		renderHook(() => useVaultPaused({ poll: true }), { wrapper })
		await waitFor(() => expect(pausedMock).toHaveBeenCalledTimes(1))

		act(() => setPageVisibility("hidden"))
		await act(() => vi.advanceTimersByTimeAsync(PAUSE_REFRESH_MS * 3))
		expect(pausedMock).toHaveBeenCalledTimes(1)

		act(() => setPageVisibility("visible"))
		await act(() => vi.advanceTimersByTimeAsync(PAUSE_REFRESH_MS))
		expect(pausedMock).toHaveBeenCalledTimes(2)
	})
})

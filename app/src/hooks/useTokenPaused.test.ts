import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { useTokenPaused } from "./useTokenPaused"

const { tokenMock } = vi.hoisted(() => ({
	tokenMock: { paused: vi.fn() },
}))

vi.mock("../config/clients", () => ({
	shareToken: async () => tokenMock,
}))

describe("useTokenPaused", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each<[boolean, string]>([
		[true, "paused"],
		[false, "open"],
	])("reads paused() %s as %s", async (value, expected) => {
		tokenMock.paused.mockResolvedValue({ result: value })
		const { result } = renderWithWallet(() => useTokenPaused())

		await waitFor(() => expect(result.current.pause).toBe(expected))
	})

	it("reports unreadable when the read fails, never open", async () => {
		tokenMock.paused.mockRejectedValue(new Error("simulation failed"))
		const { result } = renderWithWallet(() => useTokenPaused())

		await waitFor(() => expect(result.current.pause).toBe("unreadable"))
	})
})

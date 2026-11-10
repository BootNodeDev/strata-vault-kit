import { waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { investorAddress, renderWithWallet } from "./testSupport"
import { useHolderFrozen } from "./useHolderFrozen"

const { isFrozenMock } = vi.hoisted(() => ({
	isFrozenMock: vi.fn(async (_args: { user_address: string }) => ({
		result: true,
	})),
}))

vi.mock("../config/clients", () => ({
	shareToken: async () => ({ is_frozen: isFrozenMock }),
}))

describe("useHolderFrozen", () => {
	it("asks the share token whether the connected wallet is frozen", async () => {
		const { result } = renderWithWallet(useHolderFrozen)

		await waitFor(() => expect(result.current.frozen).toBe(true))
		expect(isFrozenMock).toHaveBeenCalledWith({ user_address: investorAddress })
	})

	it("reports an unreadable freeze as unknown, never as unfrozen", async () => {
		isFrozenMock.mockRejectedValueOnce(new Error("rpc down"))
		const { result } = renderWithWallet(useHolderFrozen)

		await waitFor(() => expect(isFrozenMock).toHaveBeenCalled())
		expect(result.current.frozen).toBeNull()
	})
})

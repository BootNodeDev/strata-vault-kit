import { waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { investorAddress, renderWithWallet } from "./testSupport"
import { useWindDownClaimable } from "./useWindDownClaimable"

const { claimableMock } = vi.hoisted(() => ({
	claimableMock: vi.fn(async (_args: { holder: string }) => ({
		result: 25_0000000n,
	})),
}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => ({ wind_down_claimable: claimableMock }),
}))

describe("useWindDownClaimable", () => {
	it("reads what the wind-down would pay the connected wallet now", async () => {
		const { result } = renderWithWallet(useWindDownClaimable)

		await waitFor(() => expect(result.current.claimable).toBe(25_0000000n))
		expect(claimableMock).toHaveBeenCalledWith({ holder: investorAddress })
	})

	it("reports an unreadable claimable amount as unknown, never as zero", async () => {
		claimableMock.mockRejectedValueOnce(new Error("rpc down"))
		const { result } = renderWithWallet(useWindDownClaimable)

		await waitFor(() => expect(claimableMock).toHaveBeenCalled())
		expect(result.current.claimable).toBeNull()
	})
})

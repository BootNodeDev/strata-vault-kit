import { waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { fakeAsyncVault } from "../test/fakeClients"
import { investorAddress, renderWithWallet } from "./testSupport"
import { useWindDownClaimable } from "./useWindDownClaimable"

vi.mock("../config/clients", () => import("../test/fakeClients"))

const { wind_down_claimable: claimableMock } = fakeAsyncVault(
	"wind_down_claimable",
)
claimableMock.mockResolvedValue({ result: 25_0000000n })

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

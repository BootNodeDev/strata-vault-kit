import { waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { fakeShareToken } from "../test/fakeClients"
import { investorAddress, renderWithWallet } from "./testSupport"
import { useHolderFrozen } from "./useHolderFrozen"

vi.mock("../config/clients", () => import("../test/fakeClients"))

const { is_frozen: isFrozenMock } = fakeShareToken("is_frozen")
isFrozenMock.mockResolvedValue({ result: true })

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

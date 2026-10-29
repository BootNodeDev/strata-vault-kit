import { nativeToScVal } from "@stellar/stellar-sdk"
import { act } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	contractEvent,
	investorAddress,
	renderWithWallet,
	succeededWith,
} from "./testSupport"
import { useClaimWindDown } from "./useClaimWindDown"
import { windDownClaimableKey } from "./useWindDownClaimable"

const { vaultMock } = vi.hoisted(() => ({
	vaultMock: { claim_wind_down: vi.fn() },
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: async () => vaultMock,
}))

const claimed = (surrendered: bigint, assets: bigint) =>
	contractEvent(
		"wind_down_claimed",
		nativeToScVal(
			{ surrendered, assets },
			{
				type: {
					surrendered: ["symbol", "i128"],
					assets: ["symbol", "i128"],
				},
			},
		),
	)

describe("useClaimWindDown", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("claims for the connected wallet and reports the assets paid and shares turned in", async () => {
		vaultMock.claim_wind_down.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi
				.fn()
				.mockResolvedValue(
					succeededWith(25_0000000n, [claimed(40_0000000n, 25_0000000n)]),
				),
		})
		const { result } = renderWithWallet(useClaimWindDown)

		await act(() => result.current.submit(undefined))

		expect(vaultMock.claim_wind_down).toHaveBeenCalledWith({
			holder: investorAddress,
		})
		expect(result.current.status).toEqual({
			status: "confirmed",
			assetsClaimed: 25_0000000n,
			sharesSurrendered: 40_0000000n,
		})
	})

	it("reports no shares turned in when the claim carries no claim event", async () => {
		vaultMock.claim_wind_down.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue(succeededWith(25_0000000n, [])),
		})
		const { result } = renderWithWallet(useClaimWindDown)

		await act(() => result.current.submit(undefined))

		expect(result.current.status).toEqual({
			status: "confirmed",
			assetsClaimed: 25_0000000n,
			sharesSurrendered: 0n,
		})
	})

	it("refreshes the wind-down claimable amount once the claim confirms", async () => {
		vaultMock.claim_wind_down.mockResolvedValue({
			simulation: undefined,
			signAndSend: vi.fn().mockResolvedValue(succeededWith(25_0000000n, [])),
		})
		const { result, queryClient } = renderWithWallet(useClaimWindDown)
		const invalidate = vi.spyOn(queryClient, "invalidateQueries")

		await act(() => result.current.submit(undefined))

		expect(invalidate).toHaveBeenCalledWith({ queryKey: windDownClaimableKey })
	})

	it("maps a refusal at simulation to its contract code", async () => {
		vaultMock.claim_wind_down.mockResolvedValue({
			simulation: { error: "HostError: Error(Contract, #6071)" },
		})
		const { result } = renderWithWallet(useClaimWindDown)

		await act(() => result.current.submit(undefined))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "contract-error", code: 6071 },
		})
	})
})

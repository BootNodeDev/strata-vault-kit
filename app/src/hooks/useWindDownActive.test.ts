import { type WindDownInfo } from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { useWindDownActive } from "./useWindDownActive"

const { windDownMock } = vi.hoisted(() => ({
	windDownMock: vi.fn(async (): Promise<{ result: WindDownInfo | null }> => ({
		result: null,
	})),
}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => ({ wind_down: windDownMock }),
}))

const info = (tag: "Proposed" | "Active"): WindDownInfo => ({
	active_at: 1_700_000_000n,
	round: 0,
	status: { tag, values: undefined },
})

describe("useWindDownActive", () => {
	it.each<[string, WindDownInfo | null, boolean]>([
		["no proposal", null, false],
		["a proposal not yet active", info("Proposed"), false],
		["an active wind-down", info("Active"), true],
	])("reads %s as active=%s", async (_label, value, expected) => {
		windDownMock.mockResolvedValueOnce({ result: value })
		const { result } = renderWithWallet(useWindDownActive)

		await waitFor(() => expect(result.current.windingDown).toBe(expected))
	})

	it("reports an unreadable wind-down as unknown", async () => {
		windDownMock.mockRejectedValueOnce(new Error("rpc down"))
		const { result } = renderWithWallet(useWindDownActive)

		await waitFor(() => expect(windDownMock).toHaveBeenCalled())
		expect(result.current.windingDown).toBeNull()
	})
})

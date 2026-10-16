import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { useComplianceState } from "./useComplianceState"

const { tokenMock, verifierMock, identityVerifierAtMock } = vi.hoisted(() => ({
	tokenMock: {
		is_frozen: vi.fn(),
		balance: vi.fn(),
		get_frozen_tokens: vi.fn(),
	},
	verifierMock: { is_allowed: vi.fn() },
	identityVerifierAtMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	shareToken: async () => tokenMock,
	identityVerifierAt: identityVerifierAtMock,
}))

const VERIFIER = "CVERIFIERADDRESS"
const TARGET = "GTARGETADDRESS1234"
const DESTINATION = "GDESTINATION5678"

describe("useComplianceState", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		identityVerifierAtMock.mockImplementation(async () => verifierMock)
		verifierMock.is_allowed.mockImplementation(
			async ({ account }: { account: string }) => ({
				result: account === TARGET,
			}),
		)
		tokenMock.is_frozen.mockResolvedValue({ result: true })
		tokenMock.balance.mockResolvedValue({ result: 100n })
		tokenMock.get_frozen_tokens.mockResolvedValue({ result: 40n })
	})

	it("reads nothing without a target", () => {
		const { result } = renderWithWallet(() =>
			useComplianceState({
				verifier: VERIFIER,
				target: undefined,
				destination: undefined,
			}),
		)

		expect(result.current.target).toEqual({ status: "none" })
		expect(tokenMock.balance).not.toHaveBeenCalled()
	})

	it("reads the target's allowlist, frozen state and balances", async () => {
		const { result } = renderWithWallet(() =>
			useComplianceState({
				verifier: VERIFIER,
				target: TARGET,
				destination: undefined,
			}),
		)

		expect(result.current.target).toEqual({ status: "checking" })
		await waitFor(() =>
			expect(result.current.target).toEqual({
				status: "ready",
				reads: {
					allowance: "allowed",
					frozen: true,
					shares: 100n,
					frozenShares: 40n,
				},
			}),
		)
		expect(tokenMock.balance).toHaveBeenCalledWith({ account: TARGET })
		expect(tokenMock.get_frozen_tokens).toHaveBeenCalledWith({
			user_address: TARGET,
		})
	})

	it("leaves a failed read unknown without losing the others", async () => {
		tokenMock.is_frozen.mockRejectedValue(new Error("rpc down"))
		tokenMock.balance.mockResolvedValue({
			result: 0n,
			simulation: { error: "HostError: Error(Contract, #300)" },
		})
		const { result } = renderWithWallet(() =>
			useComplianceState({
				verifier: VERIFIER,
				target: TARGET,
				destination: undefined,
			}),
		)

		await waitFor(() =>
			expect(result.current.target).toEqual({
				status: "ready",
				reads: {
					allowance: "allowed",
					frozen: null,
					shares: null,
					frozenShares: 40n,
				},
			}),
		)
	})

	it("asks the token's own verifier, and leaves the allowlist unknown without one", async () => {
		const { result } = renderWithWallet(() =>
			useComplianceState({
				verifier: null,
				target: TARGET,
				destination: undefined,
			}),
		)

		await waitFor(() =>
			expect(result.current.target).toMatchObject({
				status: "ready",
				reads: { allowance: "unreadable", frozen: true },
			}),
		)
		expect(identityVerifierAtMock).not.toHaveBeenCalled()
	})

	it("reads whether the destination is allowlisted", async () => {
		const { result } = renderWithWallet(() =>
			useComplianceState({
				verifier: VERIFIER,
				target: undefined,
				destination: DESTINATION,
			}),
		)

		await waitFor(() => expect(result.current.destination).toBe("not-allowed"))
	})
})

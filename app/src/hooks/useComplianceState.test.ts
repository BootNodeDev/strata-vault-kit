import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RWAError } from "../../../app-lib/clients/share_token/src/index"
import { simulationError } from "../test/contractErrorCode"
import {
	IDENTITY_VERIFICATION_FAILED,
	refusedWith,
	renderWithWallet,
} from "./testSupport"
import { useComplianceState } from "./useComplianceState"

const { tokenMock, verifierMock, registryMock, identityVerifierAtMock } =
	vi.hoisted(() => ({
		tokenMock: {
			is_frozen: vi.fn(),
			balance: vi.fn(),
			get_frozen_tokens: vi.fn(),
		},
		verifierMock: { verify_identity: vi.fn(), identity_registry: vi.fn() },
		registryMock: { is_vetoed: vi.fn() },
		identityVerifierAtMock: vi.fn(),
	}))

vi.mock("../config/clients", () => ({
	shareToken: async () => tokenMock,
	identityVerifierAt: identityVerifierAtMock,
	identityRegistryAt: async () => registryMock,
}))

const VERIFIER = "CVERIFIERADDRESS"
const TARGET = "GTARGETADDRESS1234"
const DESTINATION = "GDESTINATION5678"

describe("useComplianceState", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		identityVerifierAtMock.mockImplementation(async () => verifierMock)
		verifierMock.verify_identity.mockImplementation(
			async ({ account }: { account: string }) =>
				account === TARGET
					? { result: undefined }
					: refusedWith(IDENTITY_VERIFICATION_FAILED),
		)
		verifierMock.identity_registry.mockResolvedValue({ result: "CREGISTRY" })
		registryMock.is_vetoed.mockResolvedValue({ result: false })
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

	it("reads the target's allowlist, veto, frozen state and balances", async () => {
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
					vetoed: false,
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
		expect(registryMock.is_vetoed).toHaveBeenCalledWith({ account: TARGET })
	})

	it("leaves a failed read unknown without losing the others", async () => {
		tokenMock.is_frozen.mockRejectedValue(new Error("rpc down"))
		tokenMock.balance.mockResolvedValue({
			result: 0n,
			simulation: { error: simulationError(RWAError, "InsufficientBalance") },
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
					vetoed: false,
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
				reads: { allowance: "unreadable", vetoed: null, frozen: true },
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

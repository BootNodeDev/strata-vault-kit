import { type ContractRead } from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { investorAddress, renderWithWallet } from "./testSupport"
import { classifyAllowance, useIsAllowed } from "./useIsAllowed"

const { tokenMock, verifierMock, identityVerifierAtMock } = vi.hoisted(() => ({
	tokenMock: { identity_verifier: vi.fn() },
	verifierMock: { is_allowed: vi.fn() },
	identityVerifierAtMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	shareToken: async () => tokenMock,
	identityVerifierAt: identityVerifierAtMock,
}))

const allowed: ContractRead<boolean> = { kind: "value", value: true }
const notAllowed: ContractRead<boolean> = { kind: "value", value: false }
const contractError: ContractRead<boolean> = {
	kind: "contract-error",
	code: 1,
}
const unreadable: ContractRead<boolean> = { kind: "unreadable" }

describe("classifyAllowance", () => {
	it.each<[string, ContractRead<boolean>, string]>([
		["a value of true", allowed, "allowed"],
		["a value of false", notAllowed, "not-allowed"],
		["a contract error, never as not-allowed", contractError, "unreadable"],
		["an unreadable read", unreadable, "unreadable"],
	])("classifies %s as %s", (_name, read, expected) => {
		expect(classifyAllowance(read)).toBe(expected)
	})
})

describe("useIsAllowed", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		identityVerifierAtMock.mockImplementation(async () => verifierMock)
		tokenMock.identity_verifier.mockResolvedValue({ result: "CTOKENVERIFIER" })
		verifierMock.is_allowed.mockResolvedValue({ result: true })
	})

	it("reads the allowlist of the verifier the share token reports", async () => {
		const { result } = renderWithWallet(() => useIsAllowed())

		await waitFor(() => expect(result.current.allowance).toBe("allowed"))
		expect(identityVerifierAtMock).toHaveBeenCalledWith("CTOKENVERIFIER")
		expect(verifierMock.is_allowed).toHaveBeenCalledWith({
			account: investorAddress,
		})
	})

	it("is unreadable when the share token's verifier cannot be read", async () => {
		tokenMock.identity_verifier.mockRejectedValue(new Error("rpc down"))

		const { result } = renderWithWallet(() => useIsAllowed())

		await waitFor(() => expect(result.current.allowance).toBe("unreadable"))
		expect(verifierMock.is_allowed).not.toHaveBeenCalled()
	})
})

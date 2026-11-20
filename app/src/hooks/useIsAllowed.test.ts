import { type ContractRead } from "@stellar-scaffold/app-lib"
import { QueryClientProvider, useQuery } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	fakeIdentityVerifier,
	fakeShareToken,
	identityVerifierAt as identityVerifierAtMock,
} from "../test/fakeClients"
import {
	IDENTITY_NOT_FOUND,
	IDENTITY_VERIFICATION_FAILED,
	investorAddress,
	refusedWith,
	renderWithWallet,
	VERIFIER_UNAVAILABLE,
} from "./testSupport"
import {
	classifyAllowance,
	identityVerifierQuery,
	useIsAllowed,
} from "./useIsAllowed"

vi.mock("../config/clients", () => import("../test/fakeClients"))

const tokenMock = fakeShareToken("identity_verifier")
const verifierMock = fakeIdentityVerifier("verify_identity")

const allowed: ContractRead<void> = { kind: "value", value: undefined }
const refused = (code: number): ContractRead<void> => ({
	kind: "contract-error",
	code,
	name: undefined,
})
const unreadable: ContractRead<void> = { kind: "unreadable" }

describe("classifyAllowance", () => {
	it.each<[string, ContractRead<void>, string]>([
		["a verification that passes", allowed, "allowed"],
		[
			"a refused verification",
			refused(IDENTITY_VERIFICATION_FAILED),
			"not-allowed",
		],
		["a wallet with no identity", refused(IDENTITY_NOT_FOUND), "not-allowed"],
		[
			"a verifier fault, never as not-allowed",
			refused(VERIFIER_UNAVAILABLE),
			"unreadable",
		],
		["an unreadable read", unreadable, "unreadable"],
	])("classifies %s as %s", (_name, read, expected) => {
		expect(classifyAllowance(read)).toBe(expected)
	})
})

describe("useIsAllowed", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		tokenMock.identity_verifier.mockResolvedValue({ result: "CTOKENVERIFIER" })
		verifierMock.verify_identity.mockResolvedValue({ result: undefined })
	})

	it.each([
		["a refused verification", IDENTITY_VERIFICATION_FAILED, "not-allowed"],
		["a wallet with no identity", IDENTITY_NOT_FOUND, "not-allowed"],
		["a verifier fault", VERIFIER_UNAVAILABLE, "unreadable"],
	])("reports %s as %s", async (_name, code, expected) => {
		verifierMock.verify_identity.mockResolvedValue(refusedWith(code))

		const { result } = renderWithWallet(() => useIsAllowed())

		await waitFor(() => expect(result.current.allowance).toBe(expected))
	})

	it("verifies the wallet with the verifier the share token reports", async () => {
		const { result } = renderWithWallet(() => useIsAllowed())

		await waitFor(() => expect(result.current.allowance).toBe("allowed"))
		expect(identityVerifierAtMock).toHaveBeenCalledWith("CTOKENVERIFIER")
		expect(verifierMock.verify_identity).toHaveBeenCalledWith({
			account: investorAddress,
		})
	})

	it("is unreadable when the share token's verifier cannot be read", async () => {
		tokenMock.identity_verifier.mockRejectedValue(new Error("rpc down"))

		const { result } = renderWithWallet(() => useIsAllowed())

		await waitFor(() => expect(result.current.allowance).toBe("unreadable"))
		expect(verifierMock.verify_identity).not.toHaveBeenCalled()
	})

	it("reads the verifier again on the next mount after a failed read", async () => {
		tokenMock.identity_verifier.mockRejectedValueOnce(new Error("rpc down"))
		const { result, queryClient } = renderWithWallet(() => useIsAllowed())
		await waitFor(() => expect(result.current.allowance).toBe("unreadable"))

		renderHook(() => useQuery(identityVerifierQuery), {
			wrapper: ({ children }: { children: ReactNode }) =>
				createElement(QueryClientProvider, { client: queryClient }, children),
		})

		await waitFor(() => expect(result.current.allowance).toBe("allowed"))
		expect(tokenMock.identity_verifier).toHaveBeenCalledTimes(2)
	})
})

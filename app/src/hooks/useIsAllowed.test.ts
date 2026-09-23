import { type ContractRead } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { classifyAllowance } from "./useIsAllowed"

vi.mock("../config/clients", () => ({
	identityVerifier: async () => ({
		is_allowed: async () => ({}),
	}),
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

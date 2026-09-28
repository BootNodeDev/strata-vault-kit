import { type ContractRead } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { classifyPause } from "./useVaultPaused"

vi.mock("../config/clients", () => ({
	asyncVault: async () => ({
		paused: async () => ({}),
	}),
}))

const paused: ContractRead<boolean> = { kind: "value", value: true }
const open: ContractRead<boolean> = { kind: "value", value: false }
const contractError: ContractRead<boolean> = {
	kind: "contract-error",
	code: 1,
}
const unreadable: ContractRead<boolean> = { kind: "unreadable" }

describe("classifyPause", () => {
	it.each<[string, ContractRead<boolean>, string]>([
		["a value of true", paused, "paused"],
		["a value of false", open, "open"],
		["a contract error, never as open", contractError, "unreadable"],
		["an unreadable read", unreadable, "unreadable"],
	])("classifies %s as %s", (_name, read, expected) => {
		expect(classifyPause(read)).toBe(expected)
	})
})

import { type ContractRead, type Amount } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { classifyShares } from "./useSharePosition"

vi.mock("../config/clients", () => ({
	shareToken: async () => ({
		balance: async () => ({}),
	}),
}))

const zero: ContractRead<bigint> = { kind: "value", value: 0n }
const held: ContractRead<bigint> = { kind: "value", value: 500_0000000n }
const contractError: ContractRead<bigint> = {
	kind: "contract-error",
	code: 1,
}
const unreadable: ContractRead<bigint> = { kind: "unreadable" }

describe("classifyShares", () => {
	it("classifies a genuine zero as held, not unreadable", () => {
		expect(classifyShares(zero)).toEqual({
			status: "held",
			shares: 0n as Amount,
		})
	})

	it("classifies a non-zero value as held", () => {
		expect(classifyShares(held)).toEqual({
			status: "held",
			shares: 500_0000000n as Amount,
		})
	})

	it("classifies a contract error as unreadable", () => {
		expect(classifyShares(contractError)).toEqual({ status: "unreadable" })
	})

	it("classifies an unreadable read as unreadable", () => {
		expect(classifyShares(unreadable)).toEqual({ status: "unreadable" })
	})
})

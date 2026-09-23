import { type Amount, type ContractRead } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { classifyDepositBalance } from "./useDepositBalance"

vi.mock("../config/clients", () => ({
	asset: async () => ({
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

describe("classifyDepositBalance", () => {
	it("classifies a genuine zero as held, not unreadable", () => {
		expect(classifyDepositBalance(zero)).toEqual({
			status: "held",
			amount: 0n as Amount,
		})
	})

	it("classifies a non-zero value as held", () => {
		expect(classifyDepositBalance(held)).toEqual({
			status: "held",
			amount: 500_0000000n as Amount,
		})
	})

	it("classifies a contract error as unreadable", () => {
		expect(classifyDepositBalance(contractError)).toEqual({
			status: "unreadable",
		})
	})

	it("classifies an unreadable read as unreadable", () => {
		expect(classifyDepositBalance(unreadable)).toEqual({ status: "unreadable" })
	})
})

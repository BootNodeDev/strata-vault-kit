import { type ContractRead } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { toSymbols } from "./useTokenSymbols"

vi.mock("../config/clients", () => ({
	asset: async () => ({ symbol: async () => ({}) }),
	shareToken: async () => ({ symbol: async () => ({}) }),
}))

const value = (symbol: string): ContractRead<string> => ({
	kind: "value",
	value: symbol,
})
const unreadable: ContractRead<string> = { kind: "unreadable" }
const contractError: ContractRead<string> = { kind: "contract-error", code: 1 }

describe("toSymbols", () => {
	it("uses both reported symbols when both reads succeed", () => {
		expect(toSymbols(value("USDC"), value("vUSDC"))).toEqual({
			token: "USDC",
			shareToken: "vUSDC",
		})
	})

	it("falls back to TOKEN when the deposit asset's symbol read fails", () => {
		expect(toSymbols(unreadable, value("vUSDC"))).toEqual({
			token: "TOKEN",
			shareToken: "vUSDC",
		})
	})

	it("falls back to vTOKEN when the share token's symbol read fails", () => {
		expect(toSymbols(value("USDC"), contractError)).toEqual({
			token: "USDC",
			shareToken: "vTOKEN",
		})
	})

	it("falls back to both fallback symbols when both reads fail", () => {
		expect(toSymbols(unreadable, contractError)).toEqual({
			token: "TOKEN",
			shareToken: "vTOKEN",
		})
	})
})

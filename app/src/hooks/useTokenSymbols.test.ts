import { type ContractRead } from "@stellar-scaffold/app-lib"
import { describe, expect, it, vi } from "vitest"
import { toSymbols } from "./useTokenSymbols"

vi.mock("../config/clients", () => ({
	asset: async () => ({ symbol: async () => ({}) }),
	shareToken: async () => ({
		symbol: async () => ({}),
		name: async () => ({}),
	}),
}))

const value = (result: string): ContractRead<string> => ({
	kind: "value",
	value: result,
})
const unreadable: ContractRead<string> = { kind: "unreadable" }
const contractError: ContractRead<string> = { kind: "contract-error", code: 1 }

describe("toSymbols", () => {
	it("uses both reported symbols and the reported vault name when every read succeeds", () => {
		expect(
			toSymbols(value("USDC"), value("vUSDC"), value("Strata Vault")),
		).toEqual({
			token: "USDC",
			shareToken: "vUSDC",
			vaultName: "Strata Vault",
		})
	})

	it("falls back to TOKEN when the deposit asset's symbol read fails", () => {
		expect(
			toSymbols(unreadable, value("vUSDC"), value("Strata Vault")),
		).toEqual({
			token: "TOKEN",
			shareToken: "vUSDC",
			vaultName: "Strata Vault",
		})
	})

	it("falls back to vTOKEN when the share token's symbol read fails", () => {
		expect(
			toSymbols(value("USDC"), contractError, value("Strata Vault")),
		).toEqual({
			token: "USDC",
			shareToken: "vTOKEN",
			vaultName: "Strata Vault",
		})
	})

	it("falls back to Vault when the share token's name read fails", () => {
		expect(toSymbols(value("USDC"), value("vUSDC"), unreadable)).toEqual({
			token: "USDC",
			shareToken: "vUSDC",
			vaultName: "Vault",
		})
	})

	it("falls back to every fallback when all three reads fail", () => {
		expect(toSymbols(unreadable, contractError, unreadable)).toEqual({
			token: "TOKEN",
			shareToken: "vTOKEN",
			vaultName: "Vault",
		})
	})
})

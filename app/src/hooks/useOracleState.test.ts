import { type ContractRead, type OracleState } from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeNavOracle } from "../test/fakeClients"
import { renderWithWallet } from "./testSupport"
import { classifyOracle, useOracleState } from "./useOracleState"

vi.mock("../config/clients", () => import("../test/fakeClients"))

const oracleMock = fakeNavOracle("state")

const tagged = (tag: OracleState["tag"]): ContractRead<OracleState> => ({
	kind: "value",
	value: { tag, values: undefined },
})

describe("classifyOracle", () => {
	it.each<[string, ContractRead<OracleState>, string]>([
		["Valid", tagged("Valid"), "valid"],
		["Stale", tagged("Stale"), "stale"],
		["Paused", tagged("Paused"), "paused"],
		["a contract error", { kind: "contract-error", code: 1 }, "unreadable"],
		["an unreadable read", { kind: "unreadable" }, "unreadable"],
	])("classifies %s as %s", (_name, read, expected) => {
		expect(classifyOracle(read)).toBe(expected)
	})
})

describe("useOracleState", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reports the oracle as paused while the NAV is paused", async () => {
		oracleMock.state.mockResolvedValue({
			result: { tag: "Paused", values: undefined },
		})
		const { result } = renderWithWallet(() => useOracleState())

		await waitFor(() => expect(result.current.oracle).toBe("paused"))
	})

	it("reports unreadable when the read fails", async () => {
		oracleMock.state.mockRejectedValue(new Error("simulation failed"))
		const { result } = renderWithWallet(() => useOracleState())

		await waitFor(() => expect(result.current.oracle).toBe("unreadable"))
	})
})

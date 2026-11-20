import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeAsyncVault } from "../test/fakeClients"
import { renderWithWallet } from "./testSupport"
import { useVaultAuthorities } from "./useVaultAuthorities"

vi.mock("../config/clients", () => import("../test/fakeClients"))

const vaultMock = fakeAsyncVault(
	"governance",
	"manager",
	"treasury",
	"guardian",
	"custodian",
)

const settled = async () => {
	const rendered = renderWithWallet(useVaultAuthorities)
	await waitFor(() => expect(rendered.result.current.isPending).toBe(false))
	return rendered.result.current.authorities
}

describe("useVaultAuthorities", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vaultMock.governance.mockResolvedValue({ result: "GGOVERNANCE" })
		vaultMock.manager.mockResolvedValue({ result: "GMANAGER" })
		vaultMock.treasury.mockRejectedValue(new Error("network down"))
		vaultMock.guardian.mockResolvedValue({ result: "GGUARDIAN" })
		vaultMock.custodian.mockResolvedValue({ result: "GCUSTODIAN" })
	})

	it("reads every role, with an unreadable role as null and a set custodian by address", async () => {
		expect(await settled()).toEqual({
			governance: "GGOVERNANCE",
			manager: "GMANAGER",
			treasury: null,
			guardian: "GGUARDIAN",
			custodian: { kind: "set", address: "GCUSTODIAN" },
		})
	})

	it("tells a custodian that was never set apart from one it could not read", async () => {
		vaultMock.custodian.mockResolvedValue({ result: null })
		expect((await settled())?.custodian).toEqual({ kind: "unset" })

		vaultMock.custodian.mockRejectedValue(new Error("network down"))
		expect((await settled())?.custodian).toEqual({ kind: "unreadable" })
	})
})

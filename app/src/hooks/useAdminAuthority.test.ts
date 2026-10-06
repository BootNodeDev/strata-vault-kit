import type * as AppLib from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet, investorAddress } from "./testSupport"
import {
	type AuthorityReads,
	toSurfaces,
	useAdminAuthority,
} from "./useAdminAuthority"

const otherAddress = "GOTHERADDRESS1234567890"

const baseReads: AuthorityReads = {
	address: investorAddress,
	governance: { kind: "value", value: null },
	manager: { kind: "value", value: null },
	treasury: { kind: "value", value: null },
	guardian: { kind: "value", value: null },
	oracleAttester: { kind: "value", value: null },
	oracleGuardian: { kind: "value", value: null },
	tokenCompliance: { kind: "value", value: null },
	tokenAdmin: { kind: "value", value: null },
}

describe("toSurfaces", () => {
	it("grants no surface and no role label to an address with nothing", () => {
		const { surfaces, grantedBy, roles } = toSurfaces(baseReads)

		expect(surfaces).toEqual(new Set())
		expect(grantedBy).toEqual({
			cycle: [],
			compliance: [],
			emergency: [],
			configuration: [],
			governance: [],
		})
		expect(roles).toEqual([])
	})

	it("grants cycle for the vault manager", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			manager: { kind: "value", value: investorAddress },
		})

		expect(surfaces).toEqual(new Set(["cycle"]))
		expect(grantedBy.cycle).toEqual(["vault manager"])
		expect(roles).toEqual(["vault manager"])
	})

	it("grants cycle for the vault treasury", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			treasury: { kind: "value", value: investorAddress },
		})

		expect(surfaces).toEqual(new Set(["cycle"]))
		expect(grantedBy.cycle).toEqual(["vault treasury"])
		expect(roles).toEqual(["vault treasury"])
	})

	it("grants cycle for the oracle attester", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			oracleAttester: { kind: "value", value: 0 },
		})

		expect(surfaces).toEqual(new Set(["cycle"]))
		expect(grantedBy.cycle).toEqual(["oracle attester"])
		expect(roles).toEqual(["oracle attester"])
	})

	it("grants compliance for the share-token compliance", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			tokenCompliance: { kind: "value", value: 0 },
		})

		expect(surfaces).toEqual(new Set(["compliance"]))
		expect(grantedBy.compliance).toEqual(["share-token compliance"])
		expect(roles).toEqual(["share-token compliance"])
	})

	it("grants emergency for the vault guardian", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			guardian: { kind: "value", value: investorAddress },
		})

		expect(surfaces).toEqual(new Set(["emergency"]))
		expect(grantedBy.emergency).toEqual(["vault guardian"])
		expect(roles).toEqual(["vault guardian"])
	})

	it("grants emergency for the oracle guardian", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			oracleGuardian: { kind: "value", value: 0 },
		})

		expect(surfaces).toEqual(new Set(["emergency"]))
		expect(grantedBy.emergency).toEqual(["oracle guardian"])
		expect(roles).toEqual(["oracle guardian"])
	})

	it("grants emergency for the share-token admin", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			tokenAdmin: { kind: "value", value: investorAddress },
		})

		expect(surfaces).toEqual(new Set(["emergency"]))
		expect(grantedBy.emergency).toEqual(["share-token admin"])
		expect(roles).toEqual(["share-token admin"])
	})

	it("grants both configuration and governance for the vault governance, with the role listed once", () => {
		const { surfaces, grantedBy, roles } = toSurfaces({
			...baseReads,
			governance: { kind: "value", value: investorAddress },
		})

		expect(surfaces).toEqual(new Set(["configuration", "governance"]))
		expect(grantedBy.configuration).toEqual(["vault governance"])
		expect(grantedBy.governance).toEqual(["vault governance"])
		expect(roles).toEqual(["vault governance"])
	})

	it("ignores a role held by a different address", () => {
		const { surfaces, roles } = toSurfaces({
			...baseReads,
			manager: { kind: "value", value: otherAddress },
		})

		expect(surfaces).toEqual(new Set())
		expect(roles).toEqual([])
	})

	it("lists every distinct role in surface order, deduplicating the governance label", () => {
		const { roles } = toSurfaces({
			...baseReads,
			tokenCompliance: { kind: "value", value: 0 },
			tokenAdmin: { kind: "value", value: investorAddress },
			governance: { kind: "value", value: investorAddress },
		})

		expect(roles).toEqual([
			"share-token compliance",
			"share-token admin",
			"vault governance",
		])
	})
})

const {
	vaultMock,
	oracleMock,
	tokenMock,
	connectNavOracleMock,
	connectShareTokenMock,
} = vi.hoisted(() => ({
	vaultMock: {
		governance: vi.fn(),
		manager: vi.fn(),
		treasury: vi.fn(),
		guardian: vi.fn(),
		oracle: vi.fn(),
		share_token: vi.fn(),
	},
	oracleMock: { has_role: vi.fn() },
	tokenMock: {
		has_role: vi.fn(),
		get_admin: vi.fn(),
		identity_verifier: vi.fn(),
	},
	connectNavOracleMock: vi.fn(),
	connectShareTokenMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => vaultMock,
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => {
	const actual = await importOriginal<typeof AppLib>()
	return {
		...actual,
		connectNavOracle: connectNavOracleMock,
		connectShareToken: connectShareTokenMock,
	}
})

describe("useAdminAuthority", () => {
	const derivedOracleAddress = "CDERIVEDORACLEADDRESS"
	const derivedShareTokenAddress = "CDERIVEDSHARETOKENADDRESS"

	beforeEach(() => {
		vi.clearAllMocks()
		vaultMock.governance.mockResolvedValue({ result: null })
		vaultMock.manager.mockResolvedValue({ result: investorAddress })
		vaultMock.treasury.mockResolvedValue({ result: null })
		vaultMock.guardian.mockResolvedValue({ result: null })
		vaultMock.oracle.mockResolvedValue({ result: derivedOracleAddress })
		vaultMock.share_token.mockResolvedValue({
			result: derivedShareTokenAddress,
		})
		connectNavOracleMock.mockResolvedValue(oracleMock)
		connectShareTokenMock.mockResolvedValue(tokenMock)
		oracleMock.has_role.mockResolvedValue({ result: null })
		tokenMock.has_role.mockResolvedValue({ result: null })
		tokenMock.get_admin.mockResolvedValue({ result: null })
		tokenMock.identity_verifier.mockResolvedValue({
			result: "CVERIFIERADDRESS",
		})
	})

	it("reports the held surfaces and the derived addresses once every read resolves", async () => {
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(result.current.surfaces).toEqual(new Set(["cycle"]))
		expect(result.current.grantedBy.cycle).toEqual(["vault manager"])
		expect(result.current.roles).toEqual(["vault manager"])
		expect(result.current.addresses).toEqual({
			oracle: derivedOracleAddress,
			shareToken: derivedShareTokenAddress,
			identityVerifier: "CVERIFIERADDRESS",
		})
	})

	it("asks the share token for the compliance role, not manager", async () => {
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(tokenMock.has_role).toHaveBeenCalledWith({
			account: investorAddress,
			role: "compliance",
		})
	})

	it("builds the oracle and token clients from the vault's own oracle()/share_token(), not a configured address", async () => {
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(connectNavOracleMock).toHaveBeenCalledWith(derivedOracleAddress)
		expect(connectShareTokenMock).toHaveBeenCalledWith(derivedShareTokenAddress)
	})

	it("reports unreadable when a role-determining read fails, without guessing a surface", async () => {
		vaultMock.guardian.mockRejectedValue(new Error("simulation failed"))
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("unreadable"))

		expect(result.current.surfaces).toEqual(new Set())
		expect(result.current.roles).toEqual([])
	})

	it("reports unreadable without deriving any role client when the vault's share_token() read fails", async () => {
		vaultMock.share_token.mockRejectedValue(new Error("simulation failed"))
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("unreadable"))

		expect(connectNavOracleMock).not.toHaveBeenCalled()
		expect(connectShareTokenMock).not.toHaveBeenCalled()
		expect(result.current.addresses.shareToken).toBeNull()
	})

	it("reports unreadable without deriving any role client when the vault's oracle() read fails", async () => {
		vaultMock.oracle.mockRejectedValue(new Error("simulation failed"))
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("unreadable"))

		expect(connectNavOracleMock).not.toHaveBeenCalled()
		expect(connectShareTokenMock).not.toHaveBeenCalled()
		expect(result.current.addresses.oracle).toBeNull()
	})
})

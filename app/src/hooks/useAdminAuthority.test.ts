import type * as AppLib from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet, investorAddress } from "./testSupport"
import {
	type AdminSurface,
	type RoleHolders,
	toSurfaces,
	useAdminAuthority,
} from "./useAdminAuthority"

const otherAddress = "GOTHERADDRESS1234567890"
const multisig = "GMULTISIGAUTHORITY"
const secondMultisig = "GSECONDMULTISIG"
const contractHolder = "CCONTRACTHOLDER"

const noHolders: RoleHolders = {
	"vault governance": [],
	"vault manager": [],
	"vault treasury": [],
	"vault guardian": [],
	"oracle attester": [],
	"oracle guardian": [],
	"share-token compliance": [],
	"share-token admin": [],
}

const holders = (overrides: Partial<RoleHolders>): RoleHolders => ({
	...noHolders,
	...overrides,
})

const oneSignatureOf = (med: number, weight = 1) => ({
	signers: [
		{ key: investorAddress, weight },
		{ key: otherAddress, weight: 1 },
	],
	thresholds: { low: 0, med, high: med },
})

const singleKey = {
	signers: [{ key: investorAddress, weight: 1 }],
	thresholds: { low: 0, med: 0, high: 0 },
}

const emptyGrantedBy = {
	cycle: [],
	compliance: [],
	emergency: [],
	configuration: [],
	governance: [],
}

describe("toSurfaces", () => {
	it("grants no surface and no grant to a wallet that holds and signs for nothing", () => {
		const { surfaces, grantedBy, grants } = toSurfaces(
			investorAddress,
			noHolders,
			{},
		)

		expect(surfaces).toEqual(new Set())
		expect(grantedBy).toEqual(emptyGrantedBy)
		expect(grants).toEqual([])
	})

	it.each<[keyof RoleHolders, AdminSurface[]]>([
		["vault manager", ["cycle"]],
		["vault treasury", ["cycle"]],
		["oracle attester", ["cycle"]],
		["share-token compliance", ["compliance"]],
		["vault guardian", ["emergency"]],
		["oracle guardian", ["emergency"]],
		["share-token admin", ["emergency"]],
		["vault governance", ["configuration", "governance"]],
	])("grants %s's surfaces to the wallet that holds it", (role, expected) => {
		const { surfaces, grantedBy, grants } = toSurfaces(
			investorAddress,
			holders({ [role]: [investorAddress] }),
			{},
		)
		const standing = {
			role,
			authority: investorAddress,
			standing: "signs-alone",
		}

		expect(surfaces).toEqual(new Set(expected))
		for (const surface of expected)
			expect(grantedBy[surface]).toEqual([standing])
		expect(grants).toEqual([standing])
	})

	it("grants a single-key holder as signing alone", () => {
		const { grants } = toSurfaces(
			investorAddress,
			holders({ "vault manager": [investorAddress] }),
			{ [investorAddress]: singleKey },
		)

		expect(grants).toEqual([
			{
				role: "vault manager",
				authority: investorAddress,
				standing: "signs-alone",
			},
		])
	})

	it("counts the signatures a holder key needs when its weight is short of the threshold", () => {
		const { grants } = toSurfaces(
			investorAddress,
			holders({ "vault governance": [investorAddress] }),
			{ [investorAddress]: oneSignatureOf(2) },
		)

		expect(grants.map(({ standing }) => standing)).toEqual([{ needs: 2 }])
	})

	it("does not grant a holder key whose own weight is zero", () => {
		const { surfaces } = toSurfaces(
			investorAddress,
			holders({ "vault governance": [investorAddress] }),
			{ [investorAddress]: oneSignatureOf(1, 0) },
		)

		expect(surfaces).toEqual(new Set())
	})

	it("still grants the holder when its signers are unknown", () => {
		const { grants } = toSurfaces(
			investorAddress,
			holders({ "vault manager": [investorAddress] }),
			{},
		)

		expect(grants.map(({ standing }) => standing)).toEqual(["signs-alone"])
	})

	it("ignores a role held by a different account the wallet does not sign for", () => {
		const { surfaces, grants } = toSurfaces(
			investorAddress,
			holders({ "vault manager": [otherAddress] }),
			{},
		)

		expect(surfaces).toEqual(new Set())
		expect(grants).toEqual([])
	})

	it("grants a signer of the holder account, signing alone when its weight reaches the medium threshold", () => {
		const { surfaces, grantedBy } = toSurfaces(
			investorAddress,
			holders({ "vault guardian": [multisig] }),
			{ [multisig]: oneSignatureOf(1) },
		)

		expect(surfaces).toEqual(new Set(["emergency"]))
		expect(grantedBy.emergency).toEqual([
			{ role: "vault guardian", authority: multisig, standing: "signs-alone" },
		])
	})

	it("counts the signatures needed when every signer weighs 1 and the weight is short of the threshold", () => {
		const { grants } = toSurfaces(
			investorAddress,
			holders({ "oracle attester": [multisig] }),
			{ [multisig]: oneSignatureOf(2) },
		)

		expect(grants).toEqual([
			{ role: "oracle attester", authority: multisig, standing: { needs: 2 } },
		])
	})

	it("falls back to weight against threshold when the signers weigh differently", () => {
		const { grants } = toSurfaces(
			investorAddress,
			holders({ "oracle attester": [multisig] }),
			{
				[multisig]: {
					signers: [
						{ key: investorAddress, weight: 1 },
						{ key: otherAddress, weight: 3 },
					],
					thresholds: { low: 0, med: 3, high: 3 },
				},
			},
		)

		expect(grants).toEqual([
			{
				role: "oracle attester",
				authority: multisig,
				standing: { weight: 1, threshold: 3 },
			},
		])
	})

	it("does not grant a signer whose weight is zero", () => {
		const { surfaces } = toSurfaces(
			investorAddress,
			holders({ "vault guardian": [multisig] }),
			{ [multisig]: oneSignatureOf(0, 0) },
		)

		expect(surfaces).toEqual(new Set())
	})

	it("does not grant a wallet that is not among the signers of the holder", () => {
		const { surfaces } = toSurfaces(
			investorAddress,
			holders({ "vault guardian": [multisig] }),
			{
				[multisig]: {
					signers: [{ key: otherAddress, weight: 1 }],
					thresholds: { low: 0, med: 1, high: 1 },
				},
			},
		)

		expect(surfaces).toEqual(new Set())
	})

	it("grants nothing for a holder whose signers are unknown", () => {
		const { surfaces } = toSurfaces(
			investorAddress,
			holders({ "vault guardian": [multisig] }),
			{},
		)

		expect(surfaces).toEqual(new Set())
	})

	it("never grants a role held by a contract address", () => {
		const { surfaces } = toSurfaces(
			investorAddress,
			holders({ "share-token admin": [contractHolder] }),
			{},
		)

		expect(surfaces).toEqual(new Set())
	})

	it("matches the wallet against every holder of a role", () => {
		const { grants } = toSurfaces(
			investorAddress,
			holders({ "oracle attester": [otherAddress, multisig, secondMultisig] }),
			{
				[multisig]: oneSignatureOf(1),
				[secondMultisig]: oneSignatureOf(2),
			},
		)

		expect(grants).toEqual([
			{ role: "oracle attester", authority: multisig, standing: "signs-alone" },
			{
				role: "oracle attester",
				authority: secondMultisig,
				standing: { needs: 2 },
			},
		])
	})

	it("lists each grant once, in surface order, when a role grants two surfaces", () => {
		const { grants } = toSurfaces(
			investorAddress,
			holders({
				"share-token compliance": [investorAddress],
				"vault governance": [multisig],
			}),
			{ [multisig]: oneSignatureOf(1) },
		)

		expect(grants.map(({ role }) => role)).toEqual([
			"share-token compliance",
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
	accountSignersMock,
} = vi.hoisted(() => ({
	vaultMock: {
		governance: vi.fn(),
		manager: vi.fn(),
		treasury: vi.fn(),
		guardian: vi.fn(),
		oracle: vi.fn(),
		share_token: vi.fn(),
	},
	oracleMock: { get_role_member_count: vi.fn(), get_role_member: vi.fn() },
	tokenMock: {
		get_role_member_count: vi.fn(),
		get_role_member: vi.fn(),
		get_admin: vi.fn(),
		identity_verifier: vi.fn(),
	},
	connectNavOracleMock: vi.fn(),
	connectShareTokenMock: vi.fn(),
	accountSignersMock: vi.fn(),
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
		accountSigners: accountSignersMock,
	}
})

const members = (
	client: { get_role_member: ReturnType<typeof vi.fn> },
	addresses: string[],
) => {
	client.get_role_member.mockImplementation(
		async ({ index }: { index: number }) => ({ result: addresses[index] }),
	)
}

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
		oracleMock.get_role_member_count.mockResolvedValue({ result: 0 })
		tokenMock.get_role_member_count.mockResolvedValue({ result: 0 })
		tokenMock.get_admin.mockResolvedValue({ result: null })
		tokenMock.identity_verifier.mockResolvedValue({
			result: "CVERIFIERADDRESS",
		})
		accountSignersMock.mockResolvedValue(singleKey)
	})

	it("reports the held surfaces and the derived addresses once every read resolves", async () => {
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(result.current.surfaces).toEqual(new Set(["cycle"]))
		expect(result.current.grantedBy.cycle).toEqual([
			{
				role: "vault manager",
				authority: investorAddress,
				standing: "signs-alone",
			},
		])
		expect(result.current.grants).toEqual([
			{
				role: "vault manager",
				authority: investorAddress,
				standing: "signs-alone",
			},
		])
		expect(result.current.signersUnknown).toBe(false)
		expect(result.current.addresses).toEqual({
			oracle: derivedOracleAddress,
			shareToken: derivedShareTokenAddress,
			identityVerifier: "CVERIFIERADDRESS",
		})
	})

	it("builds the oracle and token clients from the vault's own oracle()/share_token(), not a configured address", async () => {
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(connectNavOracleMock).toHaveBeenCalledWith(derivedOracleAddress)
		expect(connectShareTokenMock).toHaveBeenCalledWith(derivedShareTokenAddress)
	})

	it("enumerates every member of a role on the oracle and the share token", async () => {
		oracleMock.get_role_member_count.mockImplementation(
			async ({ role }: { role: string }) => ({
				result: role === "attester" ? 2 : 0,
			}),
		)
		members(oracleMock, [otherAddress, investorAddress])
		tokenMock.get_role_member_count.mockResolvedValue({ result: 1 })
		members(tokenMock, [investorAddress])
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(oracleMock.get_role_member_count).toHaveBeenCalledWith({
			role: "attester",
		})
		expect(oracleMock.get_role_member).toHaveBeenCalledWith({
			role: "attester",
			index: 0,
		})
		expect(oracleMock.get_role_member).toHaveBeenCalledWith({
			role: "attester",
			index: 1,
		})
		expect(tokenMock.get_role_member).toHaveBeenCalledWith({
			role: "compliance",
			index: 0,
		})
		expect(result.current.surfaces).toEqual(new Set(["cycle", "compliance"]))
	})

	it("reads the share-token admin from get_admin", async () => {
		tokenMock.get_admin.mockResolvedValue({ result: investorAddress })
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(result.current.surfaces).toEqual(new Set(["cycle", "emergency"]))
		expect(result.current.grantedBy.emergency[0]?.role).toBe(
			"share-token admin",
		)
	})

	it("grants a signer of a multisig authority and looks each account up once", async () => {
		vaultMock.manager.mockResolvedValue({ result: null })
		vaultMock.governance.mockResolvedValue({ result: multisig })
		vaultMock.guardian.mockResolvedValue({ result: multisig })
		accountSignersMock.mockResolvedValue(oneSignatureOf(2))
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(result.current.surfaces).toEqual(
			new Set(["configuration", "governance", "emergency"]),
		)
		expect(result.current.grants).toEqual([
			{ role: "vault guardian", authority: multisig, standing: { needs: 2 } },
			{
				role: "vault governance",
				authority: multisig,
				standing: { needs: 2 },
			},
		])
		expect(accountSignersMock).toHaveBeenCalledWith(multisig)
		expect(accountSignersMock).toHaveBeenCalledTimes(1)
		expect(result.current.signersUnknown).toBe(false)
	})

	it("reports the holder key's standing under a 2-of-2 authority", async () => {
		vaultMock.manager.mockResolvedValue({ result: null })
		vaultMock.governance.mockResolvedValue({ result: investorAddress })
		accountSignersMock.mockResolvedValue(oneSignatureOf(2))
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(accountSignersMock).toHaveBeenCalledWith(investorAddress)
		expect(result.current.grants).toEqual([
			{
				role: "vault governance",
				authority: investorAddress,
				standing: { needs: 2 },
			},
		])
	})

	it("grants the wallet's own holder match when Horizon has no answer", async () => {
		accountSignersMock.mockResolvedValue(null)
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(result.current.signersUnknown).toBe(true)
		expect(result.current.grants).toEqual([
			{
				role: "vault manager",
				authority: investorAddress,
				standing: "signs-alone",
			},
		])
	})

	it("never asks Horizon about a contract holder", async () => {
		vaultMock.guardian.mockResolvedValue({ result: contractHolder })
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(accountSignersMock).not.toHaveBeenCalledWith(contractHolder)
		expect(result.current.signersUnknown).toBe(false)
		expect(result.current.surfaces).toEqual(new Set(["cycle"]))
	})

	it("keeps the holder match and reports signers unknown when Horizon has no answer", async () => {
		vaultMock.governance.mockResolvedValue({ result: multisig })
		accountSignersMock.mockResolvedValue(null)
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("ready"))

		expect(result.current.signersUnknown).toBe(true)
		expect(result.current.surfaces).toEqual(new Set(["cycle"]))
	})

	it("reports unreadable when a role-determining read fails, without guessing a surface", async () => {
		vaultMock.guardian.mockRejectedValue(new Error("simulation failed"))
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("unreadable"))

		expect(result.current.surfaces).toEqual(new Set())
		expect(result.current.grants).toEqual([])
	})

	it("reports unreadable when a role member read fails", async () => {
		oracleMock.get_role_member_count.mockResolvedValue({ result: 1 })
		oracleMock.get_role_member.mockRejectedValue(new Error("simulation failed"))
		const { result } = renderWithWallet(useAdminAuthority)

		await waitFor(() => expect(result.current.status).toBe("unreadable"))

		expect(result.current.surfaces).toEqual(new Set())
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

import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { useConfigurationState } from "./useConfigurationState"

const {
	vaultMock,
	tokenMock,
	oracleMock,
	useCycleReadsMock,
	useVaultAuthoritiesMock,
} = vi.hoisted(() => ({
	vaultMock: { upgrade_delay: vi.fn(), setup_open: vi.fn() },
	tokenMock: {
		compliance: vi.fn(),
		identity_verifier: vi.fn(),
		setup_open: vi.fn(),
	},
	oracleMock: { setup_open: vi.fn() },
	useCycleReadsMock: vi.fn(),
	useVaultAuthoritiesMock: vi.fn(),
}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => vaultMock,
	shareToken: async () => tokenMock,
	navOracle: async () => oracleMock,
}))
vi.mock("./useCycleState", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useCycleReads: useCycleReadsMock,
}))
vi.mock("./useVaultAuthorities", () => ({
	useVaultAuthorities: useVaultAuthoritiesMock,
}))

const CUSTODIAN = "GCUSTODIAN"
const COMPLIANCE = "CCOMPLIANCE"
const VERIFIER = "CVERIFIER"
const LIMITS = {
	freshness: 86_400n,
	cooldown: 3_600n,
	maxUpBps: 1_000,
	maxDownBps: 500,
	min: 1n,
	max: 10n,
}

const cycleReads = {
	notice: { kind: "value", value: 3_600n },
	depositCap: { kind: "uncapped" },
	windDown: { delay: 172_800n },
	oracle: { limits: LIMITS },
}

describe("useConfigurationState", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useCycleReadsMock.mockReturnValue(cycleReads)
		useVaultAuthoritiesMock.mockReturnValue({
			authorities: { custodian: { kind: "set", address: CUSTODIAN } },
			isPending: false,
		})
		vaultMock.upgrade_delay.mockResolvedValue({ result: 604_800n })
		vaultMock.setup_open.mockResolvedValue({ result: false })
		tokenMock.compliance.mockResolvedValue({ result: COMPLIANCE })
		tokenMock.identity_verifier.mockResolvedValue({ result: VERIFIER })
		tokenMock.setup_open.mockResolvedValue({ result: true })
		oracleMock.setup_open.mockResolvedValue({ result: true })
	})

	it("gathers every parameter the configuration surface can change", async () => {
		const { result } = renderWithWallet(() => useConfigurationState())

		await waitFor(() =>
			expect(result.current.configuration).toEqual({
				status: "ready",
				depositCap: { kind: "uncapped" },
				custodian: { kind: "set", address: CUSTODIAN },
				notice: 3_600n,
				windDownDelay: 172_800n,
				upgradeDelay: 604_800n,
				setupOpen: false,
				tokenSetupOpen: true,
				oracleSetupOpen: true,
				oracle: LIMITS,
				compliance: COMPLIANCE,
				identityVerifier: VERIFIER,
			}),
		)
	})

	it("says setup is open while the vault reports it", async () => {
		vaultMock.setup_open.mockResolvedValue({ result: true })
		const { result } = renderWithWallet(() => useConfigurationState())

		await waitFor(() =>
			expect(result.current.configuration).toMatchObject({ setupOpen: true }),
		)
	})

	it("reads the share token's setup state from the token, not the vault", async () => {
		vaultMock.setup_open.mockResolvedValue({ result: true })
		tokenMock.setup_open.mockResolvedValue({ result: false })
		const { result } = renderWithWallet(() => useConfigurationState())

		await waitFor(() =>
			expect(result.current.configuration).toMatchObject({
				setupOpen: true,
				tokenSetupOpen: false,
			}),
		)
	})

	it("reads the oracle's setup state from the oracle, not the vault", async () => {
		vaultMock.setup_open.mockResolvedValue({ result: true })
		oracleMock.setup_open.mockResolvedValue({ result: false })
		const { result } = renderWithWallet(() => useConfigurationState())

		await waitFor(() =>
			expect(result.current.configuration).toMatchObject({
				setupOpen: true,
				oracleSetupOpen: false,
			}),
		)
	})

	it("is checking until the cycle reads arrive", () => {
		useCycleReadsMock.mockReturnValue(undefined)
		const { result } = renderWithWallet(() => useConfigurationState())

		expect(result.current.configuration).toEqual({ status: "checking" })
	})

	it("leaves a parameter it could not read unknown, never guessed", async () => {
		vaultMock.upgrade_delay.mockRejectedValue(new Error("simulation failed"))
		vaultMock.setup_open.mockRejectedValue(new Error("simulation failed"))
		tokenMock.compliance.mockRejectedValue(new Error("simulation failed"))
		tokenMock.setup_open.mockRejectedValue(new Error("simulation failed"))
		oracleMock.setup_open.mockRejectedValue(new Error("simulation failed"))
		useCycleReadsMock.mockReturnValue({
			...cycleReads,
			notice: { kind: "unreadable" },
		})
		const { result } = renderWithWallet(() => useConfigurationState())

		await waitFor(() =>
			expect(result.current.configuration).toMatchObject({
				status: "ready",
				notice: null,
				upgradeDelay: null,
				setupOpen: null,
				tokenSetupOpen: null,
				oracleSetupOpen: null,
				compliance: null,
				identityVerifier: VERIFIER,
			}),
		)
	})
})

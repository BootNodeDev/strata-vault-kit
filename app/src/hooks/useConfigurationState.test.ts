import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { useConfigurationState } from "./useConfigurationState"

const { vaultMock, tokenMock, useCycleReadsMock, useVaultAuthoritiesMock } =
	vi.hoisted(() => ({
		vaultMock: { upgrade_delay: vi.fn() },
		tokenMock: { compliance: vi.fn(), identity_verifier: vi.fn() },
		useCycleReadsMock: vi.fn(),
		useVaultAuthoritiesMock: vi.fn(),
	}))

vi.mock("../config/clients", () => ({
	asyncVault: async () => vaultMock,
	shareToken: async () => tokenMock,
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
	maxDownBps: null,
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
			authorities: { custodian: CUSTODIAN },
			isPending: false,
		})
		vaultMock.upgrade_delay.mockResolvedValue({ result: 604_800n })
		tokenMock.compliance.mockResolvedValue({ result: COMPLIANCE })
		tokenMock.identity_verifier.mockResolvedValue({ result: VERIFIER })
	})

	it("gathers every parameter the configuration surface can change", async () => {
		const { result } = renderWithWallet(() => useConfigurationState())

		await waitFor(() =>
			expect(result.current.configuration).toEqual({
				status: "ready",
				depositCap: { kind: "uncapped" },
				custodian: CUSTODIAN,
				notice: 3_600n,
				windDownDelay: 172_800n,
				upgradeDelay: 604_800n,
				oracle: LIMITS,
				compliance: COMPLIANCE,
				identityVerifier: VERIFIER,
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
		tokenMock.compliance.mockRejectedValue(new Error("simulation failed"))
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
				compliance: null,
				identityVerifier: VERIFIER,
			}),
		)
	})

	it("polls only while active", () => {
		renderWithWallet(() => useConfigurationState({ active: false }))

		expect(useCycleReadsMock).toHaveBeenCalledWith(false)
	})
})

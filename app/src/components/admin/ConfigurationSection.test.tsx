import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type Grant } from "../../hooks/useAdminAuthority"
import { type ConfigurationState } from "../../hooks/useConfigurationState"
import { type TransactionStatus } from "../../hooks/useContractTransaction"
import ConfigurationSection from "./ConfigurationSection"

const {
	useConfigurationStateMock,
	depositCapMock,
	custodianMock,
	noticeMock,
	windDownDelayMock,
	proposeCustodianMock,
	proposeNoticeMock,
	proposeWindDownDelayMock,
	minEpochDurationMock,
	proposeMinEpochDurationMock,
	oracleConfigMock,
	complianceMock,
	identityVerifierMock,
	proposeComplianceMock,
	proposeIdentityVerifierMock,
	proposeOracleConfigMock,
} = vi.hoisted(() => {
	const tx = () => ({
		status: { status: "idle" } as { status: string },
		submit: vi.fn(() => true),
		prepare: vi.fn(),
		reset: vi.fn(),
	})
	return {
		useConfigurationStateMock: vi.fn(),
		depositCapMock: tx(),
		custodianMock: tx(),
		noticeMock: tx(),
		windDownDelayMock: tx(),
		proposeCustodianMock: tx(),
		proposeNoticeMock: tx(),
		proposeWindDownDelayMock: tx(),
		minEpochDurationMock: tx(),
		proposeMinEpochDurationMock: tx(),
		oracleConfigMock: tx(),
		complianceMock: tx(),
		identityVerifierMock: tx(),
		proposeComplianceMock: tx(),
		proposeIdentityVerifierMock: tx(),
		proposeOracleConfigMock: tx(),
	}
})

vi.mock("../../hooks/useConfigurationState", () => ({
	useConfigurationState: useConfigurationStateMock,
}))
vi.mock("../../hooks/useConfigurationTransactions", () => ({
	useSetDepositCap: () => depositCapMock,
	useSetCustodian: () => custodianMock,
	useSetNotice: () => noticeMock,
	useSetWindDownDelay: () => windDownDelayMock,
	useProposeCustodian: () => proposeCustodianMock,
	useProposeNotice: () => proposeNoticeMock,
	useProposeWindDownDelay: () => proposeWindDownDelayMock,
	useSetMinEpochDuration: () => minEpochDurationMock,
	useProposeMinEpochDuration: () => proposeMinEpochDurationMock,
	useSetOracleConfig: () => oracleConfigMock,
	useSetCompliance: () => complianceMock,
	useSetIdentityVerifier: () => identityVerifierMock,
	useProposeCompliance: () => proposeComplianceMock,
	useProposeIdentityVerifier: () => proposeIdentityVerifierMock,
	useProposeOracleConfig: () => proposeOracleConfigMock,
}))

const WALLET = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const CUSTODIAN = "CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW"
const COMPLIANCE = "CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U"
const VERIFIER = "CADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMSST"
const DAY = 86_400n
const PRICE_ONE = 10n ** 18n

const grantOf = (role: string): Grant => ({
	role,
	authority: WALLET,
	standing: "signs-alone",
})

const governance = grantOf("vault governance")
const oracleAdmin = grantOf("oracle admin")
const tokenAdmin = grantOf("share-token admin")

const READY: ConfigurationState = {
	status: "ready",
	depositCap: { kind: "uncapped" },
	custodian: { kind: "set", address: CUSTODIAN },
	notice: DAY,
	windDownDelay: 7n * DAY,
	minEpochDuration: { kind: "unset" },
	upgradeDelay: 3n * DAY,
	setupOpen: false,
	tokenSetupOpen: true,
	oracleSetupOpen: true,
	oracle: {
		freshness: DAY,
		cooldown: 3_600n,
		maxUpBps: 1_000,
		maxDownBps: 500,
		min: PRICE_ONE / 2n,
		max: 2n * PRICE_ONE,
	},
	compliance: COMPLIANCE,
	identityVerifier: VERIFIER,
}

const expand = (name: string) => {
	const toggle = screen
		.getAllByRole("button", { name })
		.find((candidate) => candidate.hasAttribute("aria-expanded"))
	if (toggle?.getAttribute("aria-expanded") === "false") fireEvent.click(toggle)
}

const submit = (name: string) =>
	screen
		.getAllByRole<HTMLButtonElement>("button", { name })
		.find((candidate) => !candidate.hasAttribute("aria-expanded"))!

describe("ConfigurationSection", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	beforeEach(() => {
		vi.clearAllMocks()
		for (const mock of [
			depositCapMock,
			custodianMock,
			noticeMock,
			windDownDelayMock,
			proposeCustodianMock,
			proposeNoticeMock,
			proposeWindDownDelayMock,
			minEpochDurationMock,
			proposeMinEpochDurationMock,
			oracleConfigMock,
			complianceMock,
			identityVerifierMock,
			proposeComplianceMock,
			proposeIdentityVerifierMock,
			proposeOracleConfigMock,
		])
			Object.assign(mock, {
				status: { status: "idle" } as TransactionStatus,
				submit: vi.fn(() => true),
				reset: vi.fn(),
			})
		useConfigurationStateMock.mockReturnValue({ configuration: READY })
	})

	it("shows the current parameters grouped by contract", () => {
		render(<ConfigurationSection grants={[governance]} wallet={WALLET} />)

		const vault = screen.getByRole("region", { name: "Vault" })
		expect(within(vault).getByText("No cap")).toBeTruthy()
		expect(within(vault).getByText("Upgrade delay")).toBeTruthy()
		expect(within(vault).getByText("Custodian")).toBeTruthy()
		const oracle = screen.getByRole("region", { name: "Oracle" })
		expect(within(oracle).getByText("10%")).toBeTruthy()
		const token = screen.getByRole("region", { name: "Share token" })
		expect(within(token).getByText("Identity verifier")).toBeTruthy()
	})

	it("prepares a typed notice once it settles and still submits it on click", () => {
		vi.useFakeTimers()
		render(<ConfigurationSection grants={[governance]} wallet={WALLET} />)
		expand("Set the notice")

		fireEvent.change(screen.getByRole("textbox", { name: "Notice" }), {
			target: { value: "2d" },
		})
		act(() => {
			vi.advanceTimersByTime(400)
		})

		expect(noticeMock.prepare).toHaveBeenCalledWith(2n * DAY, governance)

		fireEvent.click(submit("Set the notice"))

		expect(noticeMock.submit).toHaveBeenCalledWith(2n * DAY, governance)
	})

	it("prepares the proposal once a lower notice switches the row to its timelocked form", () => {
		vi.useFakeTimers()
		render(<ConfigurationSection grants={[governance]} wallet={WALLET} />)
		expand("Set the notice")
		const field = screen.getByRole("textbox", { name: "Notice" })

		fireEvent.change(field, { target: { value: "2d" } })
		act(() => {
			vi.advanceTimersByTime(400)
		})
		fireEvent.change(field, { target: { value: "12h" } })
		act(() => {
			vi.advanceTimersByTime(400)
		})

		expect(noticeMock.prepare).toHaveBeenCalledWith(2n * DAY, governance)
		expect(proposeNoticeMock.prepare).toHaveBeenCalledWith(43_200n, governance)

		fireEvent.click(submit("Set the notice"))

		expect(proposeNoticeMock.submit).toHaveBeenCalledWith(43_200n, governance)
	})

	it("prepares nothing while the configuration tab is hidden", () => {
		vi.useFakeTimers()
		render(
			<ConfigurationSection
				grants={[governance]}
				wallet={WALLET}
				active={false}
			/>,
		)
		expand("Set the notice")
		fireEvent.change(screen.getByRole("textbox", { name: "Notice" }), {
			target: { value: "2d" },
		})

		act(() => {
			vi.advanceTimersByTime(400)
		})

		expect(noticeMock.prepare).not.toHaveBeenCalled()
	})

	it("submits a new notice once typed, and follows it in the modal", () => {
		const { rerender } = render(
			<ConfigurationSection grants={[governance]} wallet={WALLET} />,
		)
		expand("Set the notice")
		expect(submit("Set the notice").disabled).toBe(true)

		fireEvent.change(screen.getByRole("textbox", { name: "Notice" }), {
			target: { value: "2d" },
		})
		fireEvent.click(submit("Set the notice"))
		expect(noticeMock.submit).toHaveBeenCalledWith(2n * DAY, governance)

		noticeMock.status = { status: "awaiting-signature" }
		rerender(<ConfigurationSection grants={[governance]} wallet={WALLET} />)
		expect(screen.getByText("New notice: 2d.")).toBeTruthy()
	})

	it("proposes a lower notice after setup and follows it in the modal", () => {
		const { rerender } = render(
			<ConfigurationSection grants={[governance]} wallet={WALLET} />,
		)
		expand("Set the notice")
		fireEvent.change(screen.getByRole("textbox", { name: "Notice" }), {
			target: { value: "12h" },
		})
		fireEvent.click(submit("Set the notice"))
		expect(proposeNoticeMock.submit).toHaveBeenCalledWith(43_200n, governance)
		expect(noticeMock.submit).not.toHaveBeenCalled()

		proposeNoticeMock.status = { status: "awaiting-signature" }
		rerender(<ConfigurationSection grants={[governance]} wallet={WALLET} />)
		expect(screen.getByText("Signing queues notice 12h.")).toBeTruthy()
	})

	it("proposes the custodian after setup and sets it at once while setup is open", () => {
		const { rerender } = render(
			<ConfigurationSection grants={[governance]} wallet={WALLET} />,
		)
		expand("Set the custodian")
		fireEvent.change(screen.getByRole("textbox", { name: "Custodian" }), {
			target: { value: VERIFIER },
		})
		fireEvent.click(submit("Set the custodian"))
		expect(proposeCustodianMock.submit).toHaveBeenCalledWith(
			VERIFIER,
			governance,
		)

		useConfigurationStateMock.mockReturnValue({
			configuration: { ...READY, setupOpen: true },
		})
		rerender(<ConfigurationSection grants={[governance]} wallet={WALLET} />)
		fireEvent.click(submit("Set the custodian"))
		expect(custodianMock.submit).toHaveBeenCalledWith(VERIFIER, governance)
	})

	it("sets the minimum epoch duration while setup is open and proposes it after", () => {
		useConfigurationStateMock.mockReturnValue({
			configuration: { ...READY, setupOpen: true },
		})
		const { rerender } = render(
			<ConfigurationSection grants={[governance]} wallet={WALLET} />,
		)
		expand("Set the minimum epoch duration")
		fireEvent.change(
			screen.getByRole("textbox", { name: "Minimum epoch duration" }),
			{ target: { value: "7d" } },
		)
		fireEvent.click(submit("Set the minimum epoch duration"))
		expect(minEpochDurationMock.submit).toHaveBeenCalledWith(
			7n * DAY,
			governance,
		)

		useConfigurationStateMock.mockReturnValue({ configuration: READY })
		rerender(<ConfigurationSection grants={[governance]} wallet={WALLET} />)
		fireEvent.click(submit("Set the minimum epoch duration"))
		expect(proposeMinEpochDurationMock.submit).toHaveBeenCalledWith(
			7n * DAY,
			governance,
		)

		proposeMinEpochDurationMock.status = { status: "awaiting-signature" }
		rerender(<ConfigurationSection grants={[governance]} wallet={WALLET} />)
		expect(
			screen.getByText("Signing queues minimum epoch duration 7d."),
		).toBeTruthy()
	})

	it("proposes the token's contracts once its setup closes and sets them at once while it is open", () => {
		useConfigurationStateMock.mockReturnValue({
			configuration: { ...READY, tokenSetupOpen: false },
		})
		const { rerender } = render(
			<ConfigurationSection grants={[tokenAdmin]} wallet={WALLET} />,
		)
		expand("Set the compliance contract")
		fireEvent.change(
			screen.getByRole("textbox", { name: "Compliance contract" }),
			{ target: { value: CUSTODIAN } },
		)
		fireEvent.click(submit("Set the compliance contract"))
		expand("Set the identity verifier")
		fireEvent.change(
			screen.getByRole("textbox", { name: "Identity verifier" }),
			{ target: { value: CUSTODIAN } },
		)
		fireEvent.click(submit("Set the identity verifier"))
		expect(proposeComplianceMock.submit).toHaveBeenCalledWith(
			CUSTODIAN,
			tokenAdmin,
		)
		expect(proposeIdentityVerifierMock.submit).toHaveBeenCalledWith(
			CUSTODIAN,
			tokenAdmin,
		)

		useConfigurationStateMock.mockReturnValue({ configuration: READY })
		rerender(<ConfigurationSection grants={[tokenAdmin]} wallet={WALLET} />)
		expand("Set the compliance contract")
		fireEvent.click(submit("Set the compliance contract"))
		expect(complianceMock.submit).toHaveBeenCalledWith(CUSTODIAN, tokenAdmin)
	})

	it("sends every oracle limit when one changes", () => {
		render(<ConfigurationSection grants={[oracleAdmin]} wallet={WALLET} />)
		expand("Set the oracle limits")

		fireEvent.change(screen.getByRole("textbox", { name: "Largest rise" }), {
			target: { value: "5" },
		})
		fireEvent.click(submit("Set the oracle limits"))

		expect(oracleConfigMock.submit).toHaveBeenCalledWith(
			{
				freshness_duration: DAY,
				cooldown_secs: 3_600n,
				max_up_bps: 500,
				max_down_bps: 500,
				min_answer: PRICE_ONE / 2n,
				max_answer: 2n * PRICE_ONE,
			},
			oracleAdmin,
		)
	})

	it("proposes new oracle limits once the oracle's setup closes and follows them in the modal", () => {
		useConfigurationStateMock.mockReturnValue({
			configuration: { ...READY, oracleSetupOpen: false },
		})
		const { rerender } = render(
			<ConfigurationSection grants={[oracleAdmin]} wallet={WALLET} />,
		)
		expand("Set the oracle limits")
		fireEvent.change(screen.getByRole("textbox", { name: "Largest rise" }), {
			target: { value: "5" },
		})
		fireEvent.click(submit("Set the oracle limits"))

		expect(proposeOracleConfigMock.submit).toHaveBeenCalledWith(
			expect.objectContaining({ max_up_bps: 500 }),
			oracleAdmin,
		)
		expect(oracleConfigMock.submit).not.toHaveBeenCalled()

		proposeOracleConfigMock.status = { status: "awaiting-signature" }
		rerender(<ConfigurationSection grants={[oracleAdmin]} wallet={WALLET} />)
		expect(
			screen.getByText("Signing queues every new oracle limit."),
		).toBeTruthy()
	})

	it("returns the fields to the current values once a change is recorded", () => {
		const { rerender } = render(
			<ConfigurationSection grants={[governance]} wallet={WALLET} />,
		)
		expand("Set the notice")
		const field = () =>
			screen.getByRole<HTMLInputElement>("textbox", { name: "Notice" })
		fireEvent.change(field(), { target: { value: "2d" } })

		noticeMock.status = { status: "confirmed" }
		rerender(<ConfigurationSection grants={[governance]} wallet={WALLET} />)

		expect(field().value).toBe("1d")
	})

	it("shows the flow modal only while the surface is active", () => {
		noticeMock.status = { status: "preparing" }
		const { rerender } = render(
			<ConfigurationSection grants={[governance]} wallet={WALLET} active />,
		)
		expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)

		rerender(
			<ConfigurationSection
				grants={[governance]}
				wallet={WALLET}
				active={false}
			/>,
		)
		expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0)
	})
})

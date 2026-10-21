import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
	oracleConfigMock,
	complianceMock,
	identityVerifierMock,
} = vi.hoisted(() => {
	const tx = () => ({
		status: { status: "idle" } as { status: string },
		submit: vi.fn(() => true),
		reset: vi.fn(),
	})
	return {
		useConfigurationStateMock: vi.fn(),
		depositCapMock: tx(),
		custodianMock: tx(),
		noticeMock: tx(),
		windDownDelayMock: tx(),
		oracleConfigMock: tx(),
		complianceMock: tx(),
		identityVerifierMock: tx(),
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
	useSetOracleConfig: () => oracleConfigMock,
	useSetCompliance: () => complianceMock,
	useSetIdentityVerifier: () => identityVerifierMock,
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

const READY: ConfigurationState = {
	status: "ready",
	depositCap: { kind: "uncapped" },
	custodian: { kind: "set", address: CUSTODIAN },
	notice: DAY,
	windDownDelay: 7n * DAY,
	upgradeDelay: 3n * DAY,
	oracle: {
		freshness: DAY,
		cooldown: 3_600n,
		maxUpBps: 1_000,
		maxDownBps: null,
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
	beforeEach(() => {
		vi.clearAllMocks()
		for (const mock of [
			depositCapMock,
			custodianMock,
			noticeMock,
			windDownDelayMock,
			oracleConfigMock,
			complianceMock,
			identityVerifierMock,
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
				max_down_bps: null,
				min_answer: PRICE_ONE / 2n,
				max_answer: 2n * PRICE_ONE,
			},
			oracleAdmin,
		)
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

	it("reads the parameters with polling only while active", () => {
		const { rerender } = render(
			<ConfigurationSection
				grants={[governance]}
				wallet={WALLET}
				active={false}
			/>,
		)
		expect(useConfigurationStateMock).toHaveBeenLastCalledWith({
			active: false,
		})

		rerender(
			<ConfigurationSection grants={[governance]} wallet={WALLET} active />,
		)
		expect(useConfigurationStateMock).toHaveBeenLastCalledWith({ active: true })
	})
})

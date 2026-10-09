import { type Amount, type Price } from "@stellar-scaffold/app-lib"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type ActivateWindDownStatus } from "../../hooks/useActivateWindDown"
import { type Grant } from "../../hooks/useAdminAuthority"
import { type AttestStatus } from "../../hooks/useAttest"
import { type CloseEpochStatus } from "../../hooks/useCloseEpoch"
import { type CycleState } from "../../hooks/useCycleState"
import { type DeployToCustodianStatus } from "../../hooks/useDeployToCustodian"
import { type DepositBalance } from "../../hooks/useDepositBalance"
import { type EpochRecord } from "../../hooks/useEpochHistory"
import { type FinalizeWindDownRoundStatus } from "../../hooks/useFinalizeWindDownRound"
import { type FulfillEpochStatus } from "../../hooks/useFulfillEpoch"
import { type FundStatus } from "../../hooks/useFund"
import CycleSection from "./CycleSection"

const {
	useCycleStateMock,
	useCycleEventsMock,
	useEpochHistoryMock,
	useDepositBalanceMock,
	closeEpochMock,
	fulfillEpochMock,
	attestMock,
	deployMock,
	fundMock,
	activateMock,
	finalizeMock,
} = vi.hoisted(() => ({
	useCycleStateMock: vi.fn(),
	useCycleEventsMock: vi.fn(),
	useEpochHistoryMock: vi.fn(),
	useDepositBalanceMock: vi.fn(),
	closeEpochMock: {
		status: { status: "idle" } as CloseEpochStatus,
		submit: vi.fn(() => true),
		reset: vi.fn(),
	},
	fulfillEpochMock: {
		status: { status: "idle" } as FulfillEpochStatus,
		submit: vi.fn(() => true),
		reset: vi.fn(),
	},
	attestMock: {
		status: { status: "idle" } as AttestStatus,
		submit: vi.fn(() => true),
		reset: vi.fn(),
	},
	deployMock: {
		status: { status: "idle" } as DeployToCustodianStatus,
		submit: vi.fn(() => true),
		reset: vi.fn(),
	},
	fundMock: {
		status: { status: "idle" } as FundStatus,
		submit: vi.fn(() => true),
		reset: vi.fn(),
	},
	activateMock: {
		status: { status: "idle" } as ActivateWindDownStatus,
		submit: vi.fn(() => true),
		reset: vi.fn(),
	},
	finalizeMock: {
		status: { status: "idle" } as FinalizeWindDownRoundStatus,
		submit: vi.fn(() => true),
		reset: vi.fn(),
	},
}))

vi.mock("../../hooks/useCycleState", () => ({
	useCycleState: useCycleStateMock,
	useCycleEvents: useCycleEventsMock,
}))
vi.mock("../../hooks/useEpochHistory", () => ({
	useEpochHistory: useEpochHistoryMock,
}))
vi.mock("../../hooks/useCloseEpoch", () => ({
	useCloseEpoch: () => closeEpochMock,
}))
vi.mock("../../hooks/useFulfillEpoch", () => ({
	useFulfillEpoch: () => fulfillEpochMock,
}))
vi.mock("../../hooks/useAttest", () => ({
	useAttest: () => attestMock,
}))
vi.mock("../../hooks/useDeployToCustodian", () => ({
	useDeployToCustodian: () => deployMock,
}))
vi.mock("../../hooks/useFund", () => ({
	useFund: () => fundMock,
}))
vi.mock("../../hooks/useActivateWindDown", () => ({
	useActivateWindDown: () => activateMock,
}))
vi.mock("../../hooks/useFinalizeWindDownRound", () => ({
	useFinalizeWindDownRound: () => finalizeMock,
}))
vi.mock("../../hooks/useDepositBalance", () => ({
	useDepositBalance: useDepositBalanceMock,
}))

const amount = (whole: bigint) => (whole * 10_000_000n) as Amount
const price = (whole: bigint) => (whole * 10n ** 18n) as Price

const sealed: EpochRecord = {
	id: 4n,
	status: "Pending",
	totalDeposited: amount(300n),
	totalSharesRedeeming: amount(20n),
	sharePrice: null,
	closedAt: 1_700_000_000n,
	priceableAt: 1_700_003_600n,
}

const open: EpochRecord = {
	id: 5n,
	status: "Open",
	totalDeposited: amount(40n),
	totalSharesRedeeming: amount(0n),
	sharePrice: null,
	closedAt: 0n,
	priceableAt: 0n,
}

type ReadyState = Extract<CycleState, { status: "ready" }>

const ready = (overrides: Partial<ReadyState> = {}): CycleState => ({
	status: "ready",
	ledgerTime: 1_700_100_000n,
	epoch: {
		id: 5n,
		open,
		awaiting: sealed,
		awaitingKnown: true,
		noticeSeconds: 3_600n,
	},
	oracle: {
		state: "valid",
		price: price(1n),
		attestedAt: 1_700_050_000n,
		expiresAt: 1_700_136_000n,
		ripcord: false,
		recorded: true,
		limits: {
			freshness: 86_400n,
			cooldown: 3_600n,
			maxUpBps: 500,
			maxDownBps: null,
			min: price(1n) / 2n,
			max: price(2n),
		},
	},
	reserve: {
		free: amount(900n),
		committed: null,
		uncovered: amount(0n),
		liquid: null,
		netDeployed: null,
		depositCap: null,
		custodian: "CCUSTODIAN1234567890",
		custodianBalance: null,
	},
	windDown: {
		phase: "none",
		activeAt: null,
		round: null,
		delay: null,
		owed: null,
		supply: null,
	},
	paused: "open",
	...overrides,
})

const WALLET = "GAUTHORITY1234567890"

const windDown = (ready() as ReadyState).windDown

const grant = (role: string, standing: Grant["standing"] = "signs-alone") => ({
	role,
	authority: WALLET,
	standing,
})

const manager = grant("vault manager")
const treasury = grant("vault treasury")
const attester = grant("oracle attester")

const button = (name: string) =>
	screen.getByRole("button", { name }) as HTMLButtonElement

describe("CycleSection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		closeEpochMock.status = { status: "idle" }
		fulfillEpochMock.status = { status: "idle" }
		attestMock.status = { status: "idle" }
		deployMock.status = { status: "idle" }
		fundMock.status = { status: "idle" }
		activateMock.status = { status: "idle" }
		finalizeMock.status = { status: "idle" }
		closeEpochMock.submit.mockReturnValue(true)
		fulfillEpochMock.submit.mockReturnValue(true)
		attestMock.submit.mockReturnValue(true)
		deployMock.submit.mockReturnValue(true)
		fundMock.submit.mockReturnValue(true)
		activateMock.submit.mockReturnValue(true)
		finalizeMock.submit.mockReturnValue(true)
		useCycleStateMock.mockReturnValue({ cycle: ready() })
		useDepositBalanceMock.mockReturnValue({
			balance: { status: "held", amount: amount(1_000n) } as DepositBalance,
		})
		useCycleEventsMock.mockReturnValue({
			cycleEvents: { status: "loaded", events: [] },
		})
		useEpochHistoryMock.mockReturnValue({
			history: {
				status: "loaded",
				currentEpoch: 5n,
				epochs: [open, sealed],
				absent: [],
				unreadable: [],
			},
		})
	})

	it("offers the manager the close and the settlement, with their conditions and resulting state", () => {
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(button("Close epoch").disabled).toBe(false)
		expect(button("Fulfill epoch").disabled).toBe(false)
		const closeConditions = screen.getByRole("list", {
			name: "Close epoch conditions",
		})
		expect(within(closeConditions).getByText("Epoch open")).toBeTruthy()
		expect(screen.getByText("Seals epoch 5 and opens epoch 6.")).toBeTruthy()
		expect(
			screen.getByText("Prices epoch 4 at 1.0000 and settles its requests."),
		).toBeTruthy()
	})

	it("offers the treasury the settlement and both reserve actions, under the Reserve group", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(screen.queryByRole("button", { name: "Close epoch" })).toBeNull()
		expect(screen.queryByRole("button", { name: "Attest price" })).toBeNull()
		expect(button("Fulfill epoch").disabled).toBe(false)
		const reserveGroup = screen.getByRole("heading", {
			name: "Reserve",
		}).parentElement!
		expect(
			within(reserveGroup).getByRole("button", { name: "Deploy to custodian" }),
		).toBeTruthy()
		expect(
			within(reserveGroup).getByRole("button", { name: "Fund the reserve" }),
		).toBeTruthy()
		expect(
			within(reserveGroup).getByRole("textbox", { name: "Amount to deploy" }),
		).toBeTruthy()
		expect(
			within(reserveGroup).getByRole("textbox", { name: "Amount to fund" }),
		).toBeTruthy()
	})

	it("offers the manager the funding but not the deployment", () => {
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(
			screen.queryByRole("button", { name: "Deploy to custodian" }),
		).toBeNull()
		expect(screen.queryByRole("button", { name: "Use max" })).toBeNull()
		expect(button("Fund the reserve").disabled).toBe(true)
		expect(screen.getByRole("textbox", { name: "Amount to fund" })).toBeTruthy()
	})

	it("holds the deployment until an amount is typed, then enables it and states the resulting reserve", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(button("Deploy to custodian").disabled).toBe(true)
		const within_ = screen.getByText("Within the free reserve").closest("li")!
		expect(within(within_).getByText("—")).toBeTruthy()

		fireEvent.change(
			screen.getByRole("textbox", { name: "Amount to deploy" }),
			{
				target: { value: "250" },
			},
		)

		expect(button("Deploy to custodian").disabled).toBe(false)
		expect(within(within_).getByText("Met")).toBeTruthy()
		expect(
			screen.getByText(
				"Sends 250.00 to the custodian; free reserve becomes 650.00.",
			),
		).toBeTruthy()
	})

	it("fills the deployment with the exact free reserve on Use max", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		fireEvent.click(button("Use max"))

		const field = screen.getByRole("textbox", {
			name: "Amount to deploy",
		}) as HTMLInputElement
		expect(field.value).toBe("900.00")
		expect(button("Deploy to custodian").disabled).toBe(false)
		expect(
			screen.getByText(
				"Sends 900.00 to the custodian; free reserve becomes 0.00.",
			),
		).toBeTruthy()
	})

	it("submits the deployment and follows it in the modal, labelled with the amount", () => {
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} />,
		)

		fireEvent.change(
			screen.getByRole("textbox", { name: "Amount to deploy" }),
			{
				target: { value: "250" },
			},
		)
		fireEvent.click(button("Deploy to custodian"))

		expect(deployMock.submit).toHaveBeenCalledWith(amount(250n))

		deployMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to deploy 250.00" }),
		).toBeTruthy()
	})

	it("labels the deployment modal with the exact amount that is signed", () => {
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} />,
		)

		fireEvent.change(
			screen.getByRole("textbox", { name: "Amount to deploy" }),
			{ target: { value: "250.1234567" } },
		)
		fireEvent.click(button("Deploy to custodian"))
		deployMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to deploy 250.1234567" }),
		).toBeTruthy()
	})

	it("clears the deployment amount once it confirms", () => {
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} />,
		)
		const field = () =>
			screen.getByRole("textbox", {
				name: "Amount to deploy",
			}) as HTMLInputElement

		fireEvent.change(field(), { target: { value: "250" } })
		fireEvent.click(button("Deploy to custodian"))
		deployMock.status = { status: "confirmed" }
		rerender(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(field().value).toBe("")
		expect(screen.getByRole("heading", { name: "Deployed" })).toBeTruthy()
	})

	it("labels the funding modal with the exact amount that is signed", () => {
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} />,
		)

		fireEvent.change(screen.getByRole("textbox", { name: "Amount to fund" }), {
			target: { value: "100.1234567" },
		})
		fireEvent.click(button("Fund the reserve"))
		fundMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to fund 100.1234567" }),
		).toBeTruthy()
	})

	it("judges the funding against the connected wallet's balance", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)
		const field = screen.getByRole("textbox", { name: "Amount to fund" })

		fireEvent.change(field, { target: { value: "1000.0000001" } })

		expect(button("Fund the reserve").disabled).toBe(true)
		const covers = screen.getByText("Wallet balance covers it").closest("li")!
		expect(within(covers).getByText("Balance 1,000.00")).toBeTruthy()

		fireEvent.change(field, { target: { value: "100" } })

		expect(button("Fund the reserve").disabled).toBe(false)
		expect(
			screen.getByText(
				"Adds 100.00 to the reserve; free reserve becomes 1,000.00.",
			),
		).toBeTruthy()
	})

	it("says the balance is unavailable and holds the funding while the wallet's balance cannot be read", () => {
		useDepositBalanceMock.mockReturnValue({
			balance: { status: "unreadable" } as DepositBalance,
		})
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		fireEvent.change(screen.getByRole("textbox", { name: "Amount to fund" }), {
			target: { value: "100" },
		})

		expect(button("Fund the reserve").disabled).toBe(true)
		const covers = screen.getByText("Wallet balance covers it").closest("li")!
		expect(within(covers).getByText("Balance unavailable")).toBeTruthy()
	})

	it("submits the funding and follows it in the modal, labelled with the amount", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)

		fireEvent.change(screen.getByRole("textbox", { name: "Amount to fund" }), {
			target: { value: "100" },
		})
		fireEvent.click(button("Fund the reserve"))

		expect(fundMock.submit).toHaveBeenCalledWith(amount(100n))

		fundMock.status = { status: "awaiting-signature" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(
			screen.getByText(
				"Signing moves 100.00 from your wallet into the vault's reserve.",
			),
		).toBeTruthy()
	})

	it("tells a treasury signing through a multisig that collecting signatures is not supported yet, while funding stays open", () => {
		render(
			<CycleSection
				grants={[grant("vault treasury", { needs: 2 })]}
				wallet={WALLET}
			/>,
		)

		fireEvent.change(
			screen.getByRole("textbox", { name: "Amount to deploy" }),
			{
				target: { value: "250" },
			},
		)

		expect(button("Deploy to custodian").disabled).toBe(true)
		expect(
			screen.getByText(
				"Needs 2 signatures; collecting them is not supported yet.",
			),
		).toBeTruthy()

		fireEvent.change(screen.getByRole("textbox", { name: "Amount to fund" }), {
			target: { value: "100" },
		})

		expect(button("Fund the reserve").disabled).toBe(false)
	})

	it("offers the attester a price field under the Price group, with the button held until a price is typed", () => {
		render(<CycleSection grants={[attester]} wallet={WALLET} />)

		const field = screen.getByRole("textbox", { name: "Share price" })
		const priceGroup = screen.getByRole("heading", {
			name: "Price",
		}).parentElement!
		expect(within(priceGroup).getByRole("textbox")).toBe(field)
		expect(button("Attest price").disabled).toBe(true)
		const band = screen.getByText("Within the band").closest("li")!
		expect(within(band).getByText("—")).toBeTruthy()

		fireEvent.change(field, { target: { value: "1.04" } })

		expect(button("Attest price").disabled).toBe(false)
		expect(within(band).getByText("Met")).toBeTruthy()
		expect(
			screen.getByText("Records 1.0400 as the share price, valid for 1d."),
		).toBeTruthy()
	})

	it("submits the typed price with the freshness window and follows it in the modal, labelled with the price", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)

		fireEvent.change(screen.getByRole("textbox", { name: "Share price" }), {
			target: { value: "1.04" },
		})
		fireEvent.click(button("Attest price"))

		expect(attestMock.submit).toHaveBeenCalledWith({
			price: 1_040_000_000_000_000_000n,
			freshness: 86_400n,
		})

		attestMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to attest 1.0400" }),
		).toBeTruthy()
	})

	it("labels the modal with the exact price that is signed", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)

		fireEvent.change(screen.getByRole("textbox", { name: "Share price" }), {
			target: { value: "1.04123456" },
		})
		fireEvent.click(button("Attest price"))
		attestMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to attest 1.04123456" }),
		).toBeTruthy()
	})

	it("clears the typed price once the attestation confirms", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)
		const field = () =>
			screen.getByRole("textbox", { name: "Share price" }) as HTMLInputElement

		fireEvent.change(field(), { target: { value: "1.04" } })
		fireEvent.click(button("Attest price"))
		attestMock.status = { status: "awaiting-signature" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)
		expect(field().value).toBe("1.04")

		attestMock.status = { status: "confirmed" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(field().value).toBe("")
		expect(button("Attest price").disabled).toBe(true)
	})

	it("keeps the typed price when the attestation is declined or refused, so it can be retried", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)
		const field = () =>
			screen.getByRole("textbox", { name: "Share price" }) as HTMLInputElement

		fireEvent.change(field(), { target: { value: "1.04" } })
		fireEvent.click(button("Attest price"))
		attestMock.status = { status: "failed", failure: { kind: "declined" } }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(field().value).toBe("1.04")
	})

	it("tells the attester how long the attested price stays valid once confirmed", () => {
		attestMock.status = { status: "confirmed" }
		render(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(screen.getByRole("heading", { name: "Price attested" })).toBeTruthy()
		expect(screen.getByText(/Valid for 1d\./)).toBeTruthy()
	})

	it("disables the settlement and marks the failing condition while the notice runs", () => {
		useCycleStateMock.mockReturnValue({
			cycle: ready({ ledgerTime: sealed.priceableAt - 1n }),
		})
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(button("Fulfill epoch").disabled).toBe(true)
		const notice = screen.getByText("Notice elapsed").closest("li")!
		expect(within(notice).getByText("Not met")).toBeTruthy()
	})

	it("tells a manager signing through a multisig that collecting signatures is not supported yet", () => {
		render(
			<CycleSection
				grants={[grant("vault manager", { needs: 2 })]}
				wallet={WALLET}
			/>,
		)

		expect(button("Close epoch").disabled).toBe(true)
		expect(
			screen.getByText(
				"Needs 2 signatures; collecting them is not supported yet.",
			),
		).toBeTruthy()
		expect(button("Fulfill epoch").disabled).toBe(false)
	})

	it("tells a signer of another account that acting on its behalf is not supported yet", () => {
		render(
			<CycleSection
				grants={[{ ...manager, authority: "GOTHERACCOUNT9876543210" }]}
				wallet={WALLET}
			/>,
		)

		expect(button("Close epoch").disabled).toBe(true)
		expect(
			screen.getByText(
				"Signs for GOTH...3210; acting on its behalf is not supported yet.",
			),
		).toBeTruthy()
	})

	it("shows no actions while the cycle is still being read", () => {
		useCycleStateMock.mockReturnValue({ cycle: { status: "checking" } })
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(screen.queryByRole("button")).toBeNull()
	})

	it("submits the close and follows it in the modal, labelled with the epoch it seals", () => {
		const { rerender } = render(
			<CycleSection grants={[manager]} wallet={WALLET} />,
		)

		fireEvent.click(button("Close epoch"))
		expect(closeEpochMock.submit).toHaveBeenCalledTimes(1)

		closeEpochMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to close epoch 5" }),
		).toBeTruthy()
	})

	it("submits the settlement for the oldest sealed epoch and follows it in the modal", () => {
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} />,
		)

		fireEvent.click(button("Fulfill epoch"))
		expect(fulfillEpochMock.submit).toHaveBeenCalledWith(4n)

		fulfillEpochMock.status = { status: "awaiting-signature" }
		rerender(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(
			screen.getByText(
				"Signing prices epoch 4 at the oracle's current price and settles its requests.",
			),
		).toBeTruthy()
	})

	it("closes the modal through the hook's reset", () => {
		fulfillEpochMock.status = {
			status: "failed",
			failure: { kind: "declined" },
		}
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		fireEvent.click(screen.getByRole("button", { name: "Close" }))

		expect(fulfillEpochMock.reset).toHaveBeenCalledTimes(1)
	})

	it("offers no wind-down action while none is proposed", () => {
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(
			screen.queryByRole("button", { name: "Activate wind-down" }),
		).toBeNull()
		expect(screen.queryByRole("button", { name: "Finalize round" })).toBeNull()
	})

	it("offers every cycle role the activation under the Wind-down group once proposed, and follows it in the modal", () => {
		const proposed = ready({
			windDown: { ...windDown, phase: "proposed", activeAt: 1_700_000_000n },
		})
		useCycleStateMock.mockReturnValue({ cycle: proposed })
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)
		const windDownGroup = screen.getByRole("heading", {
			name: "Wind-down",
		}).parentElement!
		const activate = within(windDownGroup).getByRole("button", {
			name: "Activate wind-down",
		}) as HTMLButtonElement

		expect(activate.disabled).toBe(false)
		expect(
			screen.getByText("Stops new requests and opens distribution rounds."),
		).toBeTruthy()
		fireEvent.click(activate)
		expect(activateMock.submit).toHaveBeenCalledTimes(1)

		activateMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", {
				name: "Preparing to activate the wind-down",
			}),
		).toBeTruthy()
	})

	it("submits the round and keeps its number in the modal after the cycle moves on", () => {
		const active = (round: number) =>
			ready({
				windDown: {
					...windDown,
					phase: "active",
					activeAt: 1_700_000_000n,
					round,
				},
			})
		useCycleStateMock.mockReturnValue({ cycle: active(2) })
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} />,
		)

		expect(
			screen.getByText("Distributes 900.00 to holders as round 3."),
		).toBeTruthy()
		fireEvent.click(button("Finalize round"))
		expect(finalizeMock.submit).toHaveBeenCalledTimes(1)

		finalizeMock.status = {
			status: "confirmed",
			credited: amount(900n),
		}
		useCycleStateMock.mockReturnValue({ cycle: active(3) })
		rerender(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Round 3 finalized" }),
		).toBeTruthy()
		expect(screen.getByText("900.00 is claimable by holders.")).toBeTruthy()
	})
})

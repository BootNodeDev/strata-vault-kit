import { type Amount, type Price } from "@stellar-scaffold/app-lib"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type Grant } from "../../hooks/useAdminAuthority"
import { type CloseEpochStatus } from "../../hooks/useCloseEpoch"
import { type CycleState } from "../../hooks/useCycleState"
import { type EpochRecord } from "../../hooks/useEpochHistory"
import { type FulfillEpochStatus } from "../../hooks/useFulfillEpoch"
import CycleSection from "./CycleSection"

const {
	useCycleStateMock,
	useCycleEventsMock,
	useEpochHistoryMock,
	closeEpochMock,
	fulfillEpochMock,
} = vi.hoisted(() => ({
	useCycleStateMock: vi.fn(),
	useCycleEventsMock: vi.fn(),
	useEpochHistoryMock: vi.fn(),
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
		limits: null,
	},
	reserve: {
		free: null,
		committed: null,
		uncovered: null,
		liquid: null,
		netDeployed: null,
		depositCap: null,
		custodian: null,
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

const grant = (role: string, standing: Grant["standing"] = "signs-alone") => ({
	role,
	authority: WALLET,
	standing,
})

const manager = grant("vault manager")
const treasury = grant("vault treasury")

const button = (name: string) =>
	screen.getByRole("button", { name }) as HTMLButtonElement

describe("CycleSection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		closeEpochMock.status = { status: "idle" }
		fulfillEpochMock.status = { status: "idle" }
		closeEpochMock.submit.mockReturnValue(true)
		fulfillEpochMock.submit.mockReturnValue(true)
		useCycleStateMock.mockReturnValue({ cycle: ready() })
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

	it("offers the treasury only the settlement", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(screen.queryByRole("button", { name: "Close epoch" })).toBeNull()
		expect(button("Fulfill epoch").disabled).toBe(false)
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
})

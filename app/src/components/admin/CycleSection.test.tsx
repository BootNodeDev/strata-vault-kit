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
		proof: { hash: "cd".repeat(32), uri: "https://example.com/nav.pdf" },
		navPaused: false,
		recorded: true,
		limits: {
			freshness: 86_400n,
			cooldown: 3_600n,
			maxUpBps: 500,
			maxDownBps: 1_000,
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
		custodian: { kind: "set", address: "CCUSTODIAN1234567890" },
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

const rowToggle = (label: string) =>
	screen
		.getAllByRole("button", { name: label })
		.find((candidate) => candidate.hasAttribute("aria-expanded"))!

const openRow = (label: string) => {
	const toggle = rowToggle(label)
	if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle)
}

const button = (name: string) => {
	openRow(name)
	return screen
		.getAllByRole("button", { name })
		.find(
			(candidate) => !candidate.hasAttribute("aria-expanded"),
		) as HTMLButtonElement
}

const FIELD_ROWS: Record<string, string> = {
	"Amount to deploy": "Deploy to custodian",
	"Amount to fund": "Fund the reserve",
	"Share price": "Attest price",
	"Proof hash": "Attest price",
	"Proof URI": "Attest price",
}

const PROOF_HASH = "ab".repeat(32)

const typeAttestation = (price: string, proofUri = "") => {
	fireEvent.change(fieldOf("Share price"), { target: { value: price } })
	fireEvent.change(fieldOf("Proof hash"), { target: { value: PROOF_HASH } })
	fireEvent.change(fieldOf("Proof URI"), { target: { value: proofUri } })
}

const fieldOf = (name: string) => {
	openRow(FIELD_ROWS[name]!)
	return screen.getByRole("textbox", { name }) as HTMLInputElement
}

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
		const closeConditions = screen.getByRole("list", {
			name: "Close epoch conditions",
		})
		expect(within(closeConditions).getByText("Epoch open")).toBeTruthy()
		expect(button("Fulfill epoch").disabled).toBe(false)
		expect(screen.getByText("Seals epoch 5 and opens epoch 6.")).toBeTruthy()
		expect(
			screen.getByText("Prices epoch 4 at 1.0000 and settles its requests."),
		).toBeTruthy()
	})

	it("offers the treasury the settlement and both reserve actions, in the Actions rail", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(screen.queryByRole("button", { name: "Close epoch" })).toBeNull()
		expect(screen.queryByRole("button", { name: "Attest price" })).toBeNull()
		expect(button("Fulfill epoch").disabled).toBe(false)
		const rail = screen.getByRole("complementary", { name: "Actions" })
		expect(rail.contains(fieldOf("Amount to deploy"))).toBe(true)
		expect(rail.contains(button("Deploy to custodian"))).toBe(true)
		expect(rail.contains(fieldOf("Amount to fund"))).toBe(true)
		expect(rail.contains(button("Fund the reserve"))).toBe(true)
	})

	it("offers the manager the funding but not the deployment", () => {
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(
			screen.queryByRole("button", { name: "Deploy to custodian" }),
		).toBeNull()
		expect(screen.queryByRole("button", { name: "Use max" })).toBeNull()
		expect(button("Fund the reserve").disabled).toBe(true)
		expect(fieldOf("Amount to fund")).toBeTruthy()
	})

	it("holds the deployment until an amount is typed, then enables it and states the resulting reserve", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(button("Deploy to custodian").disabled).toBe(true)
		const within_ = screen.getByText("Within the free reserve").closest("li")!
		expect(within_.textContent).toBe("Pending: Within the free reserve")

		fireEvent.change(fieldOf("Amount to deploy"), {
			target: { value: "250" },
		})

		expect(button("Deploy to custodian").disabled).toBe(false)
		expect(within_.textContent).toBe("Pass: Within the free reserve")
		expect(
			screen.getByText(
				"Sends 250.00 to the custodian; free reserve becomes 650.00.",
			),
		).toBeTruthy()
	})

	it("fills the deployment with the exact free reserve on Use max", () => {
		render(<CycleSection grants={[treasury]} wallet={WALLET} />)

		const field = fieldOf("Amount to deploy")
		fireEvent.click(screen.getByRole("button", { name: "Use max" }))

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

		fireEvent.change(fieldOf("Amount to deploy"), {
			target: { value: "250" },
		})
		fireEvent.click(button("Deploy to custodian"))

		expect(deployMock.submit).toHaveBeenCalledWith(amount(250n), treasury)

		deployMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[treasury]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to deploy 250.00" }),
		).toBeTruthy()
	})

	it("shows the flow modal only while the surface is active, and again on return", () => {
		deployMock.status = { status: "preparing" }
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} active />,
		)
		expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)

		rerender(
			<CycleSection grants={[treasury]} wallet={WALLET} active={false} />,
		)
		expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0)
		expect(deployMock.reset).not.toHaveBeenCalled()

		rerender(<CycleSection grants={[treasury]} wallet={WALLET} active />)
		expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1)
	})

	it("labels the deployment modal with the exact amount that is signed", () => {
		const { rerender } = render(
			<CycleSection grants={[treasury]} wallet={WALLET} />,
		)

		fireEvent.change(fieldOf("Amount to deploy"), {
			target: { value: "250.1234567" },
		})
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
		const field = () => fieldOf("Amount to deploy")

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

		fireEvent.change(fieldOf("Amount to fund"), {
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
		const field = fieldOf("Amount to fund")

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

		fireEvent.change(fieldOf("Amount to fund"), {
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

		fireEvent.change(fieldOf("Amount to fund"), {
			target: { value: "100" },
		})
		fireEvent.click(button("Fund the reserve"))

		expect(fundMock.submit).toHaveBeenCalledWith(amount(100n), undefined)

		fundMock.status = { status: "awaiting-signature" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(
			screen.getByText(
				"Signing moves 100.00 from your wallet into the vault's reserve.",
			),
		).toBeTruthy()
	})

	it("lets a treasury signing through a multisig deploy, passing its grant", () => {
		const shared = grant("vault treasury", { needs: 2 })
		render(<CycleSection grants={[shared]} wallet={WALLET} />)

		fireEvent.change(fieldOf("Amount to deploy"), {
			target: { value: "250" },
		})
		fireEvent.click(button("Deploy to custodian"))

		expect(deployMock.submit).toHaveBeenCalledWith(amount(250n), shared)
	})

	it("offers the attester a price field in the Actions rail, with the button held until a price is typed", () => {
		render(<CycleSection grants={[attester]} wallet={WALLET} />)

		const field = fieldOf("Share price")
		const rail = screen.getByRole("complementary", { name: "Actions" })
		expect(within(rail).getByRole("textbox", { name: "Share price" })).toBe(
			field,
		)
		expect(button("Attest price").disabled).toBe(true)
		const band = screen.getByText("Within the band").closest("li")!
		expect(band.textContent).toMatch(/^Pending: Within the band/)

		fireEvent.change(field, { target: { value: "1.04" } })

		expect(band.textContent).toMatch(/^Pass: Within the band/)
		expect(button("Attest price").disabled).toBe(true)

		fireEvent.change(fieldOf("Proof hash"), { target: { value: PROOF_HASH } })

		expect(button("Attest price").disabled).toBe(false)
		expect(
			screen.getByText("Records 1.0400 as the share price, valid for 1d."),
		).toBeTruthy()
	})

	it("submits the typed price with the freshness window and follows it in the modal, labelled with the price", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)

		typeAttestation("1.04", "https://example.com/nav.pdf")
		fireEvent.click(button("Attest price"))

		expect(attestMock.submit).toHaveBeenCalledWith(
			{
				price: 1_040_000_000_000_000_000n,
				freshness: 86_400n,
				proofHash: PROOF_HASH,
				proofUri: "https://example.com/nav.pdf",
			},
			attester,
		)

		attestMock.status = { status: "preparing" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(
			screen.getByRole("heading", { name: "Preparing to attest 1.0400" }),
		).toBeTruthy()
	})

	it("collects the proof hash and the proof URI in the attest form, sending an attestation without a URI", () => {
		render(<CycleSection grants={[attester]} wallet={WALLET} />)
		const rail = screen.getByRole("complementary", { name: "Actions" })

		openRow("Attest price")
		expect(
			within(rail).getByRole("textbox", { name: "Proof hash" }),
		).toBeTruthy()
		expect(
			within(rail).getByRole("textbox", { name: "Proof URI" }),
		).toBeTruthy()

		typeAttestation("1.04")
		fireEvent.click(button("Attest price"))

		expect(attestMock.submit).toHaveBeenCalledWith(
			expect.objectContaining({ proofHash: PROOF_HASH, proofUri: "" }),
			attester,
		)
	})

	it("shows the latest proof in the Price group, its URI as a link", () => {
		render(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(screen.getByText("cdcd...cdcd")).toBeTruthy()
		expect(
			screen
				.getByRole("link", { name: "https://example.com/nav.pdf" })
				.getAttribute("href"),
		).toBe("https://example.com/nav.pdf")
	})

	it("labels the modal with the exact price that is signed", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)

		typeAttestation("1.04123456")
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
		const field = () => fieldOf("Share price")

		typeAttestation("1.04", "https://example.com/nav.pdf")
		fireEvent.click(button("Attest price"))
		attestMock.status = { status: "awaiting-signature" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)
		expect(field().value).toBe("1.04")

		attestMock.status = { status: "confirmed" }
		rerender(<CycleSection grants={[attester]} wallet={WALLET} />)

		expect(field().value).toBe("")
		expect(fieldOf("Proof hash").value).toBe("")
		expect(fieldOf("Proof URI").value).toBe("")
		expect(button("Attest price").disabled).toBe(true)
	})

	it("keeps the typed price when the attestation is declined or refused, so it can be retried", () => {
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)
		const field = () => fieldOf("Share price")

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
		expect(notice.textContent).toMatch(/^Fail: Notice elapsed/)
	})

	it("lets a manager signing through a multisig close the epoch, passing its grant", () => {
		const shared = grant("vault manager", { needs: 2 })
		render(<CycleSection grants={[shared]} wallet={WALLET} />)

		fireEvent.click(button("Close epoch"))

		expect(closeEpochMock.submit).toHaveBeenCalledWith(undefined, shared)
	})

	it("lets a signer of another account close the epoch, passing that account's grant", () => {
		const other = { ...manager, authority: "GOTHERACCOUNT9876543210" }
		render(<CycleSection grants={[other]} wallet={WALLET} />)

		fireEvent.click(button("Close epoch"))

		expect(closeEpochMock.submit).toHaveBeenCalledWith(undefined, other)
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
		expect(fulfillEpochMock.submit).toHaveBeenCalledWith(4n, undefined)

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

	it("lists the role's actions in the rail with their readiness, the first ready one open", () => {
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		const rail = screen.getByRole("complementary", { name: "Actions" })
		expect(within(rail).getByText("2 of 3 ready")).toBeTruthy()
		expect(rowToggle("Close epoch").getAttribute("aria-expanded")).toBe("true")
		expect(rowToggle("Fulfill epoch").getAttribute("aria-expanded")).toBe(
			"false",
		)
		expect(rowToggle("Fund the reserve").getAttribute("aria-expanded")).toBe(
			"false",
		)
	})

	it("keeps the overview free of actions and the static limits behind a disclosure", () => {
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		const rail = screen.getByRole("complementary", { name: "Actions" })
		const overviewButtons = screen
			.getAllByRole("button")
			.filter((candidate) => !rail.contains(candidate))
		expect(overviewButtons).toEqual([])
		const limits = screen
			.getAllByText("Limits")
			.map((summary) => summary.closest("details")!)
		expect(limits.every((disclosure) => !disclosure.open)).toBe(true)
		expect(within(limits[0]!).getByText("Freshness window")).toBeTruthy()
		expect(within(limits[1]!).getByText("Deposit cap")).toBeTruthy()
	})

	it("keeps the row open after its action confirms", () => {
		const { rerender } = render(
			<CycleSection grants={[manager]} wallet={WALLET} />,
		)
		fireEvent.click(button("Close epoch"))

		closeEpochMock.status = {
			status: "confirmed",
			sealedEpoch: 5n,
			hash: "abc",
		}
		rerender(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(rowToggle("Close epoch").getAttribute("aria-expanded")).toBe("true")
	})

	it("offers no wind-down action while none is proposed", () => {
		render(<CycleSection grants={[manager]} wallet={WALLET} />)

		expect(
			screen.queryByRole("button", { name: "Activate wind-down" }),
		).toBeNull()
		expect(screen.queryByRole("button", { name: "Finalize round" })).toBeNull()
	})

	it("offers every cycle role the activation in the Actions rail once proposed, and follows it in the modal", () => {
		const proposed = ready({
			windDown: { ...windDown, phase: "proposed", activeAt: 1_700_000_000n },
		})
		useCycleStateMock.mockReturnValue({ cycle: proposed })
		const { rerender } = render(
			<CycleSection grants={[attester]} wallet={WALLET} />,
		)
		const rail = screen.getByRole("complementary", { name: "Actions" })
		const activate = button("Activate wind-down")

		expect(rail.contains(activate)).toBe(true)
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

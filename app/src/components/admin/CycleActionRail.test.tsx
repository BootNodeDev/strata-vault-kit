import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type RailAction, type RailField } from "../../pages/actions"
import { type CycleAction } from "../../pages/cycle"
import CycleActionRail from "./CycleActionRail"

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
}))

const closeAction: CycleAction = {
	id: "close-epoch",
	group: "Epoch",
	label: "Close epoch",
	conditions: [
		{ label: "Wind-down not active", met: true },
		{ label: "Epoch open", met: true },
	],
	outcome: "Seals epoch 5 and opens epoch 6.",
	epochId: 5n,
	enabled: true,
}

const fulfillAction: CycleAction = {
	id: "fulfill-epoch",
	group: "Epoch",
	label: "Fulfill epoch",
	conditions: [
		{ label: "Sealed epoch awaiting a price", met: true },
		{ label: "Notice elapsed", met: false },
	],
	outcome: "Prices epoch 4 at 1.0000 and settles its requests.",
	epochId: 4n,
	enabled: false,
}

const attestAction: CycleAction = {
	id: "attest",
	group: "Price",
	label: "Attest price",
	conditions: [
		{ label: "Within the band", met: null },
		{ label: "Cooldown elapsed", met: true },
	],
	outcome: null,
	field: {
		label: "Share price",
		placeholder: "0.0000",
		value: "",
		invalid: false,
	},
	price: null,
	freshness: null,
	proofHash: null,
	proofUri: "",
	enabled: false,
}

const deployAction: CycleAction = {
	id: "deploy",
	group: "Reserve",
	label: "Deploy to custodian",
	conditions: [
		{ label: "Custodian set", met: true, detail: "CCUS...7890" },
		{ label: "Within the free reserve", met: null },
	],
	outcome: null,
	field: {
		label: "Amount to deploy",
		placeholder: "0.00",
		value: "",
		invalid: false,
		max: "900.0000001",
	},
	amount: null,
	enabled: false,
}

const unavailableClose: CycleAction = {
	...closeAction,
	enabled: false,
	unavailable: "Could not read the manager's account.",
}

const renderRail = (
	actions: CycleAction[],
	{
		onRun = vi.fn(),
		onInput = vi.fn(),
		pending = false,
		unreadable = false,
	}: {
		onRun?: (action: CycleAction) => void
		onInput?: (action: CycleAction, value: string) => void
		pending?: boolean
		unreadable?: boolean
	} = {},
) =>
	render(
		<CycleActionRail
			scope="cycle"
			actions={actions}
			pending={pending}
			unreadable={unreadable}
			onRun={onRun}
			onInput={onInput}
		/>,
	)

const rowToggle = (label: string) =>
	screen
		.getAllByRole("button", { name: label })
		.find((button) => button.hasAttribute("aria-expanded"))!

const submitButton = (label: string) =>
	screen
		.getAllByRole("button", { name: label })
		.find((button) => !button.hasAttribute("aria-expanded")) as
		HTMLButtonElement | undefined

const expand = (label: string) => {
	const toggle = rowToggle(label)
	if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle)
}

const expanded = (label: string) =>
	rowToggle(label).getAttribute("aria-expanded") === "true"

describe("CycleActionRail", () => {
	it("summarises an action that changes nothing as no change", () => {
		renderRail([
			{
				...fulfillAction,
				conditions: [
					{ label: "Differs from current", met: false, unchanged: true },
				],
			},
		])

		expect(rowToggle("Fulfill epoch").textContent).toBe(
			"Fulfill epochNo change",
		)
	})

	it("heads the rail with how many of its actions are ready", () => {
		renderRail([closeAction, fulfillAction, attestAction])

		expect(screen.getByRole("heading", { name: "Actions" })).toBeTruthy()
		expect(screen.getByText("1 of 3 ready")).toBeTruthy()
	})

	it("lists one row per action, in order, summarising its readiness", () => {
		renderRail([unavailableClose, fulfillAction, attestAction, deployAction])

		expect(
			screen
				.getAllByRole("button")
				.filter((button) => button.hasAttribute("aria-expanded"))
				.map((toggle) => toggle.textContent),
		).toEqual([
			"Close epochUnavailable",
			"Fulfill epochBlocked",
			"Attest priceBlocked",
			"Deploy to custodianBlocked",
		])
		for (const [name, description] of [
			["Close epoch", "Unavailable"],
			["Fulfill epoch", "Blocked"],
			["Attest price", "Blocked"],
			["Deploy to custodian", "Blocked"],
		] as const)
			expect(
				screen.getAllByRole("button", { name, description })[0],
			).toBeTruthy()
	})

	it("summarises a ready action as Ready", () => {
		renderRail([closeAction])

		expect(
			screen.getByRole("button", { name: "Close epoch", description: "Ready" }),
		).toBeTruthy()
	})

	it("opens the first ready action and keeps the others collapsed", () => {
		renderRail([fulfillAction, closeAction, { ...attestAction, enabled: true }])

		expect(expanded("Fulfill epoch")).toBe(false)
		expect(expanded("Close epoch")).toBe(true)
		expect(expanded("Attest price")).toBe(false)
		expect(submitButton("Close epoch")).toBeTruthy()
		expect(submitButton("Fulfill epoch")).toBeUndefined()
	})

	it("keeps every row collapsed when no action is ready", () => {
		renderRail([fulfillAction, attestAction])

		expect(expanded("Fulfill epoch")).toBe(false)
		expect(expanded("Attest price")).toBe(false)
		expect(screen.queryByRole("textbox")).toBeNull()
	})

	it("opens one row at a time and collapses the open row on a second click", () => {
		renderRail([closeAction, fulfillAction])

		fireEvent.click(rowToggle("Fulfill epoch"))

		expect(expanded("Fulfill epoch")).toBe(true)
		expect(expanded("Close epoch")).toBe(false)
		expect(submitButton("Fulfill epoch")).toBeTruthy()
		expect(submitButton("Close epoch")).toBeUndefined()

		fireEvent.click(rowToggle("Fulfill epoch"))

		expect(expanded("Fulfill epoch")).toBe(false)
		expect(expanded("Close epoch")).toBe(false)
	})

	it("controls the region holding the action's content", () => {
		renderRail([closeAction, fulfillAction])

		const region = document.getElementById(
			rowToggle("Fulfill epoch").getAttribute("aria-controls")!,
		)!
		expect(region.hidden).toBe(true)

		fireEvent.click(rowToggle("Fulfill epoch"))

		expect(region.hidden).toBe(false)
		expect(
			within(region).getByRole("button", { name: "Fulfill epoch" }),
		).toBeTruthy()
	})

	it("keeps the open row open once its action stops being ready", () => {
		const { rerender } = renderRail([closeAction, fulfillAction])

		rerender(
			<CycleActionRail
				scope="cycle"
				actions={[
					{ ...closeAction, enabled: false },
					{ ...fulfillAction, enabled: true },
				]}
				pending={false}
				unreadable={false}
				onRun={vi.fn()}
			/>,
		)

		expect(expanded("Close epoch")).toBe(true)
		expect(expanded("Fulfill epoch")).toBe(false)
	})

	it("opens the first ready action once the actions arrive", () => {
		const { rerender } = renderRail([], { pending: true })

		rerender(
			<CycleActionRail
				scope="cycle"
				actions={[fulfillAction, closeAction]}
				pending={false}
				unreadable={false}
				onRun={vi.fn()}
			/>,
		)

		expect(expanded("Close epoch")).toBe(true)
	})

	it("shows a loading line and no rows while the actions are being read", () => {
		renderRail([], { pending: true })

		expect(screen.queryByRole("button")).toBeNull()
		expect(screen.queryByText(/ready/)).toBeNull()
	})

	it("says so when there is no action to offer", () => {
		renderRail([])

		expect(screen.getByText("No actions available.")).toBeTruthy()
	})

	it("says the cycle state could not be read, not that no action exists", () => {
		renderRail([], { unreadable: true })

		expect(screen.getByText("Could not read the cycle state.")).toBeTruthy()
		expect(screen.queryByText("No actions available.")).toBeNull()
	})

	it("names the surface it serves when its state could not be read", () => {
		render(
			<CycleActionRail
				scope="emergency"
				actions={[]}
				pending={false}
				unreadable
				onRun={vi.fn()}
			/>,
		)

		expect(screen.getByText("Could not read the emergency state.")).toBeTruthy()
	})

	it("lists each condition as pass or fail, in words for screen readers", () => {
		renderRail([fulfillAction])
		expand("Fulfill epoch")

		const list = screen.getByRole("list", { name: "Fulfill epoch conditions" })
		expect(
			within(list)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["Pass: Sealed epoch awaiting a price", "Fail: Notice elapsed"])
		expect(within(list).queryByText(/Met|Not met/)).toBeNull()
	})

	it("states the resulting state before the button and runs only an enabled action", () => {
		const onRun = vi.fn()
		renderRail([closeAction, fulfillAction], { onRun })

		expect(screen.getByText("Seals epoch 5 and opens epoch 6.")).toBeTruthy()
		const close = submitButton("Close epoch")!
		expect(close.disabled).toBe(false)
		fireEvent.click(close)
		expand("Fulfill epoch")
		const fulfill = submitButton("Fulfill epoch")!
		expect(fulfill.disabled).toBe(true)
		fireEvent.click(fulfill)

		expect(onRun).toHaveBeenCalledTimes(1)
		expect(onRun).toHaveBeenCalledWith(closeAction)
	})

	it("says in full why an action is unavailable once expanded, keeping its button disabled", () => {
		renderRail([unavailableClose])
		expand("Close epoch")

		expect(
			screen.getByText("Could not read the manager's account."),
		).toBeTruthy()
		expect(submitButton("Close epoch")?.disabled).toBe(true)
	})

	it("omits the resulting state when there is none to show", () => {
		renderRail([{ ...fulfillAction, outcome: null }])
		expand("Fulfill epoch")

		expect(screen.queryByText(/Prices epoch/)).toBeNull()
		expect(submitButton("Fulfill epoch")).toBeTruthy()
	})

	it("asks for a figure in a decimal field, labelled for screen readers, and reports each keystroke", () => {
		const onInput = vi.fn()
		renderRail([attestAction], { onInput })
		expand("Attest price")

		const field = screen.getByRole("textbox", {
			name: "Share price",
		}) as HTMLInputElement
		expect(field.placeholder).toBe("0.0000")
		expect(field.inputMode).toBe("decimal")

		fireEvent.change(field, { target: { value: "1.04" } })

		expect(onInput).toHaveBeenCalledWith(attestAction, "1.04")
	})

	it("renders no field for an action that takes no figure", () => {
		renderRail([closeAction])

		expect(screen.queryByRole("textbox")).toBeNull()
	})

	it("marks a condition pending while it cannot be judged yet", () => {
		renderRail([attestAction])
		expand("Attest price")

		const band = screen.getByText("Within the band").closest("li")!
		expect(band.textContent).toBe("Pending: Within the band")
	})

	it("keeps a failing condition's detail next to its label", () => {
		renderRail([
			{
				...attestAction,
				conditions: [
					{ label: "Within the band", met: false, detail: "0.5000 – 2.0000" },
				],
			},
		])
		expand("Attest price")

		const band = screen.getByText("Within the band").closest("li")!
		expect(band.textContent).toBe("Fail: Within the band0.5000 – 2.0000")
		expect(within(band).getByText("0.5000 – 2.0000")).toBeTruthy()
	})

	it("keeps a passing condition's detail next to its label", () => {
		renderRail([deployAction])
		expand("Deploy to custodian")

		const custodian = screen.getByText("Custodian set").closest("li")!
		expect(custodian.textContent).toBe("Pass: Custodian setCCUS...7890")
	})

	it("offers to fill the field with its max, reporting the exact figure", () => {
		const onInput = vi.fn()
		renderRail([deployAction], { onInput })
		expand("Deploy to custodian")

		fireEvent.click(screen.getByRole("button", { name: "Use max" }))

		expect(onInput).toHaveBeenCalledWith(deployAction, "900.0000001")
	})

	it("offers no max for a field that has none", () => {
		renderRail([attestAction])
		expand("Attest price")

		expect(screen.queryByRole("button", { name: "Use max" })).toBeNull()
	})

	it("states an action's note outside the conditions", () => {
		renderRail([
			{ ...attestAction, note: "NAV paused — attesting does not unpause it." },
		])
		expand("Attest price")

		const list = screen.getByRole("list", { name: "Attest price conditions" })
		expect(
			screen.getByText("NAV paused — attesting does not unpause it."),
		).toBeTruthy()
		expect(within(list).queryByText(/NAV paused/)).toBeNull()
	})
})

describe("CycleActionRail with keyed fields", () => {
	const setLimits: RailAction = {
		id: "set-oracle-config",
		label: "Set the oracle limits",
		conditions: [{ label: "Differs from current", met: true }],
		outcome: null,
		fields: [
			{
				key: "freshness",
				label: "Freshness window",
				placeholder: "7d",
				value: "2d",
				invalid: false,
				text: true,
				current: "1d",
				next: "2d",
			},
			{
				key: "floor",
				label: "Price floor",
				placeholder: "0.00",
				value: "0.5",
				invalid: false,
				current: "0.50",
				next: null,
			},
		],
		enabled: true,
	}

	const renderKeyed = (onInput = vi.fn()) => {
		render(
			<CycleActionRail
				scope="configuration"
				actions={[setLimits]}
				pending={false}
				unreadable={false}
				onRun={vi.fn()}
				onInput={onInput}
			/>,
		)
		return onInput
	}

	it("labels every field and reports each keystroke with the field's key", () => {
		const onInput = renderKeyed()

		const freshness = screen.getByRole("textbox", { name: "Freshness window" })
		fireEvent.change(freshness, { target: { value: "3d" } })
		fireEvent.change(screen.getByRole("textbox", { name: "Price floor" }), {
			target: { value: "0.6" },
		})

		expect(onInput).toHaveBeenNthCalledWith(1, setLimits, "3d", "freshness")
		expect(onInput).toHaveBeenNthCalledWith(2, setLimits, "0.6", "floor")
	})

	it("keeps an action open and its field focused when its route changes id", () => {
		const setNotice: RailAction = { ...setLimits, slot: "set-limits" }
		const rail = (action: RailAction) => (
			<CycleActionRail
				scope="configuration"
				actions={[action]}
				pending={false}
				unreadable={false}
				onRun={vi.fn()}
			/>
		)
		const { rerender } = render(rail(setNotice))
		const field = screen.getByRole("textbox", { name: "Freshness window" })
		field.focus()

		rerender(rail({ ...setNotice, id: "propose-oracle-config" }))

		expect(expanded("Set the oracle limits")).toBe(true)
		expect(document.activeElement).toBe(field)
	})

	it("shows the current value next to the field and the new one once it reads", () => {
		renderKeyed()

		expect(screen.getByText("Current 1d")).toBeTruthy()
		expect(screen.getByText("New 2d")).toBeTruthy()
		expect(screen.getByText("Current 0.50")).toBeTruthy()
		expect(screen.queryByText(/^New 0/)).toBeNull()
	})

	it("asks for text where the field is not a figure", () => {
		renderKeyed()

		expect(
			(
				screen.getByRole("textbox", {
					name: "Freshness window",
				}) as HTMLInputElement
			).inputMode,
		).toBe("text")
		expect(
			(screen.getByRole("textbox", { name: "Price floor" }) as HTMLInputElement)
				.inputMode,
		).toBe("decimal")
	})
})

describe("CycleActionRail choice fields", () => {
	const grantRole = (checked = false): RailAction<RailField> => ({
		id: "grant-vault-role",
		label: "Grant a vault role",
		conditions: [{ label: "Confirmed", met: checked }],
		outcome: null,
		fields: [
			{
				kind: "select",
				key: "role",
				label: "Role",
				value: "treasury",
				options: [
					{ value: "manager", label: "Manager" },
					{ value: "treasury", label: "Treasury" },
				],
			},
			{
				kind: "confirm",
				key: "confirm",
				label: "Merges two vault roles on one account.",
				value: "treasury:GABC",
				checked,
			},
		],
		enabled: checked,
	})

	const renderChoices = (action: RailAction<RailField>) => {
		const onInput = vi.fn()
		render(
			<CycleActionRail
				scope="governance"
				actions={[action]}
				pending={false}
				unreadable={false}
				onRun={vi.fn()}
				onInput={onInput}
			/>,
		)
		const collapsed = screen.queryByRole("button", {
			name: "Grant a vault role",
			expanded: false,
		})
		if (collapsed !== null) fireEvent.click(collapsed)
		return onInput
	}

	it("offers the options of a select and reports the chosen one with its key", () => {
		const action = grantRole()
		const onInput = renderChoices(action)
		const select = screen.getByRole<HTMLSelectElement>("combobox", {
			name: "Role",
		})

		expect(select.value).toBe("treasury")
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Manager", "Treasury"])
		fireEvent.change(select, { target: { value: "manager" } })
		expect(onInput).toHaveBeenCalledWith(action, "manager", "role")
	})

	it("shows the label of a select", () => {
		renderChoices(grantRole())

		expect(screen.getByText("Role").className).not.toContain("srOnly")
	})

	it.each([
		[false, "treasury:GABC"],
		[true, ""],
	])(
		"toggles a confirmation checked %s by reporting %o",
		(checked, reported) => {
			const action = grantRole(checked)
			const onInput = renderChoices(action)
			const check = screen.getByRole<HTMLInputElement>("checkbox", {
				name: "Merges two vault roles on one account.",
			})

			expect(check.checked).toBe(checked)
			fireEvent.click(check)
			expect(onInput).toHaveBeenCalledWith(action, reported, "confirm")
		},
	)
})

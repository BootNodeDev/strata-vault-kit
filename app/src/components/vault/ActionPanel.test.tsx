import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ActionPanel, { type ActionPanelProps } from "./ActionPanel"

const baseProps: ActionPanelProps = {
	side: "subscribe",
	onSideChange: () => {},
	heading: "Request a subscription",
	note: "Your request joins the batch that is currently open.",
	amount: "",
	onAmountChange: () => {},
	amountLabel: "Amount to subscribe",
	ticker: "TOKEN",
	balance: 18400,
	balanceLabel: "Balance 18,400.00",
	estimate: { label: "Estimated shares", status: "ready", value: "≈ —" },
	submitLabel: "Subscribe",
	onSubmit: () => {},
}

describe("ActionPanel", () => {
	it("disables submit when the amount is empty", () => {
		render(<ActionPanel {...baseProps} amount="" />)

		const button = screen.getByRole("button", {
			name: "Subscribe",
		}) as HTMLButtonElement
		expect(button.disabled).toBe(true)
	})

	it("reports the balance to the caller when the max control is used", () => {
		const onAmountChange = vi.fn()
		render(
			<ActionPanel {...baseProps} amount="" onAmountChange={onAmountChange} />,
		)

		fireEvent.click(screen.getByRole("button", { name: "MAX" }))

		expect(onAmountChange).toHaveBeenCalledWith("18,400.00")
	})

	it("asks for an amount, not that the estimate is unavailable, when the field is empty", () => {
		render(
			<ActionPanel
				{...baseProps}
				amount=""
				estimate={{
					label: "Estimated shares",
					status: "empty",
					reason: "Enter an amount to see the estimate.",
				}}
			/>,
		)

		expect(
			screen.getByText("Enter an amount to see the estimate."),
		).toBeTruthy()
		expect(screen.queryByText("Estimate unavailable")).toBeNull()
	})

	it("renders the unavailable text instead of a figure when no fresh price exists", () => {
		render(
			<ActionPanel
				{...baseProps}
				amount="1000"
				estimate={{
					label: "Estimated shares",
					status: "unavailable",
					reason: "Estimate unavailable",
				}}
			/>,
		)

		expect(screen.getByText("Estimate unavailable")).toBeTruthy()
	})

	it("renders the computed figure when the estimate is ready", () => {
		render(
			<ActionPanel
				{...baseProps}
				amount="1000"
				estimate={{
					label: "Estimated shares",
					status: "ready",
					value: "≈ 500.00 vUSDC",
				}}
			/>,
		)

		expect(screen.getByText("≈ 500.00 vUSDC")).toBeTruthy()
	})

	it("renders the form with a single actionable control for an action block", () => {
		const onPress = vi.fn()
		const onSubmit = vi.fn()
		render(
			<ActionPanel
				{...baseProps}
				balance={null}
				onSubmit={onSubmit}
				block={{
					kind: "action",
					reason: "Connect a wallet to subscribe or redeem.",
					label: "Connect Wallet",
					onPress,
				}}
			/>,
		)

		expect(screen.getByRole("tablist")).toBeTruthy()
		expect(
			screen.getByText("Connect a wallet to subscribe or redeem."),
		).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull()

		fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))

		expect(onPress).toHaveBeenCalledOnce()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it("hides the whole panel, tabs included, for a message block that covers both sides", () => {
		render(
			<ActionPanel
				{...baseProps}
				balance={null}
				block={{
					kind: "message",
					reason: "This address is not on the vault's allowlist.",
					sides: ["subscribe", "redeem"],
				}}
			/>,
		)

		expect(screen.queryByRole("tablist")).toBeNull()
		expect(screen.queryByRole("textbox")).toBeNull()
		expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull()
		expect(
			screen.getByText("This address is not on the vault's allowlist."),
		).toBeTruthy()
	})

	it("keeps the tabs reachable for a message block scoped to the current side only", () => {
		render(
			<ActionPanel
				{...baseProps}
				balance={null}
				block={{
					kind: "message",
					reason: "The vault is not accepting new requests right now.",
					sides: ["subscribe"],
				}}
			/>,
		)

		expect(screen.getByRole("tablist")).toBeTruthy()
		expect(screen.queryByRole("textbox")).toBeNull()
		expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull()
		expect(
			screen.getByText("The vault is not accepting new requests right now."),
		).toBeTruthy()
	})

	it("leaves the other side's form untouched by a block scoped to the current side", () => {
		render(
			<ActionPanel
				{...baseProps}
				side="redeem"
				submitLabel="Redeem"
				block={{
					kind: "message",
					reason: "The vault is not accepting new requests right now.",
					sides: ["subscribe"],
				}}
			/>,
		)

		expect(screen.getByRole("tablist")).toBeTruthy()
		expect(screen.getByRole("textbox")).toBeTruthy()
		expect(screen.getByRole("button", { name: "Redeem" })).toBeTruthy()
		expect(
			screen.queryByText("The vault is not accepting new requests right now."),
		).toBeNull()
	})

	it("hides MAX and cannot reach the over-balance state when balance is null", () => {
		render(<ActionPanel {...baseProps} balance={null} amount="999999999" />)

		expect(screen.queryByRole("button", { name: "MAX" })).toBeNull()
		expect(screen.queryByText(/Enter .* or less/)).toBeNull()
		const button = screen.getByRole("button", {
			name: "Subscribe",
		}) as HTMLButtonElement
		expect(button.disabled).toBe(false)
	})
})

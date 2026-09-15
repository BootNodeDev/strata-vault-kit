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
	estimate: { label: "Estimated shares", value: "≈ —" },
	submitLabel: "Request subscription",
	onSubmit: () => {},
}

describe("ActionPanel", () => {
	it("disables submit when the amount is empty", () => {
		render(<ActionPanel {...baseProps} amount="" />)

		const button = screen.getByRole("button", {
			name: "Enter an amount",
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

	it("renders the unavailable text instead of a figure when no fresh price exists", () => {
		render(
			<ActionPanel
				{...baseProps}
				amount="1000"
				estimate={{
					label: "Estimated shares",
					value: null,
				}}
			/>,
		)

		expect(screen.getByText("Estimate unavailable")).toBeTruthy()
	})
})

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import LifecyclePanel, { type LifecycleStep } from "./LifecyclePanel"

const steps: [LifecycleStep, LifecycleStep, LifecycleStep] = [
	{
		title: "Request subscription",
		actor: "YOU",
		body: "Your TOKEN joins the open epoch and sits in escrow.",
	},
	{
		title: "Priced",
		actor: "NEXT ATTESTATION",
		body: "Your epoch is sealed, then priced at the next attested value.",
	},
	{
		title: "Claim your shares",
		actor: "YOU",
		body: "Claim to receive the shares in your wallet.",
	},
]

describe("LifecyclePanel", () => {
	it('marks only the step matching currentStep with aria-current="step"', () => {
		render(
			<LifecyclePanel
				title="Subscription lifecycle"
				progress="Step 2 of 3"
				steps={steps}
				currentStep={2}
			/>,
		)

		const items = screen.getAllByRole("listitem")
		expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([
			null,
			"step",
			null,
		])
	})

	it("marks no step as current when currentStep is null", () => {
		render(
			<LifecyclePanel
				title="Subscription lifecycle"
				progress="Nothing open"
				steps={steps}
				currentStep={null}
			/>,
		)

		const items = screen.getAllByRole("listitem")
		expect(
			items.every((item) => item.getAttribute("aria-current") === null),
		).toBe(true)
	})
})

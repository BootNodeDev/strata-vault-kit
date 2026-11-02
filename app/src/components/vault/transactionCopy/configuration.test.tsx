import type * as AppLib from "@stellar-scaffold/app-lib"
import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { renderConfigurationModal } from "../../../test/renderTransactionModal"
import TransactionModal, {
	type ConfigurationModalAction,
} from "../TransactionModal"

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerTransaction: () => null,
}))

describe("TransactionModal, configuration actions", () => {
	it.each<[ConfigurationModalAction, string, string]>([
		[
			"set-deposit-cap",
			"Preparing to set the deposit cap",
			"Deposit cap updated",
		],
		["set-custodian", "Preparing to set the custodian", "Custodian updated"],
		["set-notice", "Preparing to set the notice", "Notice updated"],
		[
			"set-wind-down-delay",
			"Preparing to set the wind-down delay",
			"Wind-down delay updated",
		],
		[
			"set-min-epoch-duration",
			"Preparing to set the minimum epoch duration",
			"Minimum epoch duration updated",
		],
		[
			"set-oracle-config",
			"Preparing to set the oracle limits",
			"Oracle limits updated",
		],
		[
			"set-compliance",
			"Preparing to set the compliance contract",
			"Compliance contract updated",
		],
		[
			"set-identity-verifier",
			"Preparing to set the identity verifier",
			"Identity verifier updated",
		],
	])("walks %s from preparing to confirmed", (action, preparing, confirmed) => {
		const { rerender } = renderConfigurationModal(action, {
			status: "preparing",
		})
		expect(screen.getByRole("heading", { name: preparing })).toBeTruthy()

		rerender(
			<TransactionModal
				action={action}
				status={{ status: "confirmed" }}
				value="3d"
				onClose={vi.fn()}
				onRetry={vi.fn()}
			/>,
		)
		expect(screen.getByRole("heading", { name: confirmed })).toBeTruthy()
	})

	it("states the new value before signing and once recorded", () => {
		const { rerender } = renderConfigurationModal(
			"set-deposit-cap",
			{ status: "awaiting-signature" },
			"5,000.00",
		)
		expect(screen.getByText("New deposit cap: 5,000.00.")).toBeTruthy()

		rerender(
			<TransactionModal
				action="set-deposit-cap"
				status={{ status: "confirmed" }}
				value="5,000.00"
				onClose={vi.fn()}
				onRetry={vi.fn()}
			/>,
		)
		expect(screen.getByText("Deposit cap: 5,000.00.")).toBeTruthy()
	})

	it.each<[ConfigurationModalAction, string]>([
		["set-custodian", "Treasury deploys to the new address from now on."],
		["set-notice", "Applies to epochs closed from now on."],
		["set-wind-down-delay", "A proposed wind-down keeps its activation time."],
		[
			"set-min-epoch-duration",
			"Anyone may seal an epoch once it has been open this long.",
		],
	])("names the side effect of %s once recorded", (action, effect) => {
		renderConfigurationModal(action, { status: "confirmed" }, "3d")

		expect(screen.getByText(effect)).toBeTruthy()
	})

	it.each<[ConfigurationModalAction, string, string, string, string]>([
		[
			"propose-custodian",
			"GABC...WXYZ",
			"Preparing to propose a custodian",
			"Signing queues custodian GABC...WXYZ.",
			"Custodian GABC...WXYZ applies once the upgrade delay passes.",
		],
		[
			"propose-notice",
			"12h",
			"Preparing to propose a notice",
			"Signing queues notice 12h.",
			"Notice 12h applies once the upgrade delay passes.",
		],
		[
			"propose-wind-down-delay",
			"8d",
			"Preparing to propose a wind-down delay",
			"Signing queues wind-down delay 8d.",
			"Wind-down delay 8d applies once the upgrade delay passes.",
		],
		[
			"propose-min-epoch-duration",
			"7d",
			"Preparing to propose a minimum epoch duration",
			"Signing queues minimum epoch duration 7d.",
			"Minimum epoch duration 7d applies once the upgrade delay passes.",
		],
		[
			"propose-compliance",
			"CABC...WXYZ",
			"Preparing to propose a compliance contract",
			"Signing queues compliance contract CABC...WXYZ.",
			"Compliance contract CABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"propose-identity-verifier",
			"CABC...WXYZ",
			"Preparing to propose an identity verifier",
			"Signing queues identity verifier CABC...WXYZ.",
			"Identity verifier CABC...WXYZ applies once the vault's upgrade delay passes.",
		],
		[
			"propose-oracle-config",
			"",
			"Preparing to propose oracle limits",
			"Signing queues every new oracle limit.",
			"The new oracle limits apply once the vault's upgrade delay passes.",
		],
	])(
		"walks %s from preparing to proposed",
		(action, value, preparing, signing, doneBody) => {
			const { rerender } = renderConfigurationModal(
				action,
				{ status: "preparing" },
				value,
			)
			expect(screen.getByRole("heading", { name: preparing })).toBeTruthy()

			rerender(
				<TransactionModal
					action={action}
					status={{ status: "awaiting-signature" }}
					value={value}
					onClose={vi.fn()}
					onRetry={vi.fn()}
				/>,
			)
			expect(screen.getByText(signing)).toBeTruthy()

			rerender(
				<TransactionModal
					action={action}
					status={{ status: "confirmed" }}
					value={value}
					onClose={vi.fn()}
					onRetry={vi.fn()}
				/>,
			)
			expect(
				screen.getByRole("heading", { name: "Change proposed" }),
			).toBeTruthy()
			expect(screen.getByText(doneBody)).toBeTruthy()
		},
	)

	it.each<[ConfigurationModalAction, string, string, RegExp]>([
		[
			"set-deposit-cap",
			"InvalidAmount",
			"vault",
			/The deposit cap cannot be negative/,
		],
		[
			"set-notice",
			"NoticeTooLong",
			"vault",
			/The notice cannot exceed 30 days/,
		],
		[
			"set-notice",
			"NoticeAboveUpgradeDelay",
			"vault",
			/The notice cannot exceed the upgrade delay/,
		],
		[
			"set-wind-down-delay",
			"WindDownDelayTooLong",
			"vault",
			/The wind-down delay cannot exceed 90 days/,
		],
		[
			"set-wind-down-delay",
			"WindDownDelayTooShort",
			"vault",
			/The wind-down delay cannot be under 7 days/,
		],
		[
			"set-min-epoch-duration",
			"InvalidAmount",
			"vault",
			/The minimum epoch duration must be 1 to 30 days/,
		],
		[
			"propose-min-epoch-duration",
			"InvalidAmount",
			"vault",
			/The minimum epoch duration must be 1 to 30 days/,
		],
		[
			"propose-custodian",
			"InvalidCustodian",
			"vault",
			/custodian cannot be the vault/,
		],
		["propose-notice", "SetupOpen", "vault", /Setup is still open/],
		["set-notice", "UseTimelock", "vault", /goes through the timelock/],
		[
			"propose-custodian",
			"TooManyPendingChanges",
			"vault",
			/16 pending changes/,
		],
		[
			"set-oracle-config",
			"InvalidConfig",
			"oracle",
			/One of the oracle limits is out of range/,
		],
		["set-compliance", "Unauthorized", "share token", /does not hold the role/],
		[
			"propose-compliance",
			"TooManyPendingChanges",
			"share token",
			/16 pending changes/,
		],
		[
			"propose-identity-verifier",
			"SetupOpen",
			"share token",
			/Setup is still open/,
		],
		[
			"set-compliance",
			"UseTimelock",
			"share token",
			/goes through the timelock/,
		],
		[
			"propose-compliance",
			"WindDownActive",
			"share token",
			/vault is winding down/,
		],
	])(
		"names the reason %s was refused with %s",
		(action, name, refuser, sentence) => {
			renderConfigurationModal(action, {
				status: "failed",
				failure: { kind: "contract-error", code: 0, name },
			})

			expect(
				screen.getByRole("heading", {
					name: `The ${refuser} refused this request`,
				}),
			).toBeTruthy()
			expect(screen.getByText(sentence)).toBeTruthy()
		},
	)

	it("sends an unknown outcome to the Configuration tab", () => {
		renderConfigurationModal("set-notice", {
			status: "failed",
			failure: { kind: "unknown" },
		})

		expect(
			screen.getByText(/check the Configuration tab before trying again/),
		).toBeTruthy()
	})
})

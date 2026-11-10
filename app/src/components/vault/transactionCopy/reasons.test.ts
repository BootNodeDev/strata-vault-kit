import { generatedSpecs } from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { ADMIN_COPY } from "./admin"
import {
	activateWindDownCopy,
	attestCopy,
	closeEpochCopy,
	deployCopy,
	finalizeRoundCopy,
	fulfillEpochCopy,
	fundCopy,
} from "./cycle"
import {
	cancelCopy,
	cancelRedeemCopy,
	claimCopy,
	claimRedeemCopy,
	claimWindDownCopy,
	redeemCopy,
	subscribeCopy,
} from "./investor"
import { type Reasons } from "./types"

const copies: [string, { reasons: Reasons }][] = [
	["subscribe", subscribeCopy("", "")],
	["cancel", cancelCopy("", "")],
	["cancel-redeem", cancelRedeemCopy("", "", "", false)],
	["claim", claimCopy("", "", "")],
	["redeem", redeemCopy("", "")],
	["claim-redeem", claimRedeemCopy("", "", "")],
	["claim-wind-down", claimWindDownCopy("", "", "")],
	["close-epoch", closeEpochCopy("")],
	["fulfill-epoch", fulfillEpochCopy("")],
	["attest", attestCopy("", null)],
	["deploy", deployCopy("")],
	["fund", fundCopy("")],
	["activate-wind-down", activateWindDownCopy()],
	["finalize-round", finalizeRoundCopy("")],
	...Object.entries(ADMIN_COPY).map(
		([action, copy]): [string, { reasons: Reasons }] => [action, copy("")],
	),
]

describe("transaction copy reasons", () => {
	it("keys every reason by an error name a generated client declares", () => {
		const names = new Set(
			generatedSpecs().flatMap((spec) =>
				spec.errorCases().map((errorCase) => errorCase.name().toString()),
			),
		)

		for (const [action, copy] of copies) {
			for (const name of Object.keys(copy.reasons)) {
				expect(names, `${action} reason ${name}`).toContain(name)
			}
		}
	})
})

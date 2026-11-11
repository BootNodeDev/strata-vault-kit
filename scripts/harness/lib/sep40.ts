import { scValToNative, type xdr } from "@stellar/stellar-sdk"

import { type Asset } from "../../../app-lib/clients/sep40_feed/dist/index.js"

export const stellarAsset = (id: string): Asset => ({
	tag: "Stellar",
	values: [id],
})

export type Recorded = "price_recorded" | "no_price"

// Diagnostic events also carry the host's own fn_call/fn_return pair, whose
// type is "diagnostic" rather than "contract": skip those.
export function recordedEvent(
	events: readonly xdr.DiagnosticEvent[],
): Recorded | undefined {
	for (const diagnostic of events) {
		const event = diagnostic.event()
		if (event.type().name !== "contract") continue
		const [first] = event.body().v0().topics()
		if (first === undefined) continue
		const name: unknown = scValToNative(first)
		if (name === "price_recorded" || name === "no_price") return name
	}
	return undefined
}

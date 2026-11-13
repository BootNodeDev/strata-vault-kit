import { scValToNative, type xdr } from "@stellar/stellar-sdk"

import { type Asset } from "../../../app-lib/clients/sep40_feed/dist/index.js"

export const stellarAsset = (id: string): Asset => ({
	tag: "Stellar",
	values: [id],
})

export type Recorded = "price_recorded" | "no_price"

export interface DecodedEvent {
	name: Recorded
	topics: unknown[]
	data: unknown
}

// A transaction's contract events also carry the host's own fn_call/
// fn_return pair, whose type is "diagnostic" rather than "contract": skip
// those.
function find(events: readonly xdr.ContractEvent[]): DecodedEvent | undefined {
	for (const event of events) {
		if (event.type().name !== "contract") continue
		const body = event.body().v0()
		const [first, ...rest] = body.topics()
		if (first === undefined) continue
		const name: unknown = scValToNative(first)
		if (name !== "price_recorded" && name !== "no_price") continue
		return {
			name,
			topics: rest.map((topic) => scValToNative(topic)),
			data: scValToNative(body.data()),
		}
	}
	return undefined
}

export function decodedEvent(
	events: readonly xdr.ContractEvent[],
): DecodedEvent | undefined {
	return find(events)
}

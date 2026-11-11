import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { decodedEvent } from "./sep40.js"

const contractEvent = (
	topics: xdr.ScVal[],
	data: xdr.ScVal = xdr.ScVal.scvVoid(),
) =>
	new xdr.ContractEvent({
		ext: new xdr.ExtensionPoint(0),
		contractId: null,
		type: xdr.ContractEventType.contract(),
		body: new xdr.ContractEventBody(
			0,
			new xdr.ContractEventV0({ topics, data }),
		),
	})

const hostEvent = (topic: string) =>
	new xdr.ContractEvent({
		ext: new xdr.ExtensionPoint(0),
		contractId: null,
		type: xdr.ContractEventType.diagnostic(),
		body: new xdr.ContractEventBody(
			0,
			new xdr.ContractEventV0({
				topics: [xdr.ScVal.scvSymbol(topic)],
				data: xdr.ScVal.scvVoid(),
			}),
		),
	})

const diagnostic = (event: xdr.ContractEvent) =>
	new xdr.DiagnosticEvent({ inSuccessfulContractCall: true, event })

describe("decodedEvent", () => {
	it("finds a missing price", () => {
		const events = [
			diagnostic(contractEvent([xdr.ScVal.scvSymbol("no_price")])),
		]

		expect(decodedEvent(events)?.name).toBe("no_price")
	})

	it("decodes the price recorded event's topics and data", () => {
		const feed = Keypair.random().publicKey()
		// A Rust contracttype enum variant with a field encodes as a vec
		// [Symbol(variant), ...fields], which scValToNative decodes as an array.
		const asset = ["Stellar", feed]
		const data = {
			decimals: 14,
			price: 100n,
			resolution: 300,
			timestamp: 1_700_000_000n,
		}
		const events = [
			diagnostic(
				contractEvent(
					[
						xdr.ScVal.scvSymbol("price_recorded"),
						nativeToScVal(feed, { type: "address" }),
						xdr.ScVal.scvVec([
							xdr.ScVal.scvSymbol("Stellar"),
							nativeToScVal(feed, { type: "address" }),
						]),
					],
					nativeToScVal(data, {
						type: {
							decimals: ["symbol", "u32"],
							price: ["symbol", "i128"],
							resolution: ["symbol", "u32"],
							timestamp: ["symbol", "u64"],
						},
					}),
				),
			),
		]

		expect(decodedEvent(events)).toEqual({
			name: "price_recorded",
			topics: [feed, asset],
			data,
		})
	})

	it("finds nothing among the host's call events", () => {
		const events = [diagnostic(hostEvent("fn_call"))]

		expect(decodedEvent(events)).toBeUndefined()
	})
})

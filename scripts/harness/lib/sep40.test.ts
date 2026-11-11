import { xdr } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { recordedEvent } from "./sep40.js"

const contractEvent = (topic: string) =>
	new xdr.ContractEvent({
		ext: new xdr.ExtensionPoint(0),
		contractId: null,
		type: xdr.ContractEventType.contract(),
		body: new xdr.ContractEventBody(
			0,
			new xdr.ContractEventV0({
				topics: [xdr.ScVal.scvSymbol(topic)],
				data: xdr.ScVal.scvVoid(),
			}),
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

describe("recordedEvent", () => {
	it("finds a recorded price", () => {
		const events = [diagnostic(contractEvent("price_recorded"))]

		expect(recordedEvent(events)).toBe("price_recorded")
	})

	it("finds a missing price", () => {
		const events = [diagnostic(contractEvent("no_price"))]

		expect(recordedEvent(events)).toBe("no_price")
	})

	it("ignores the host's call events", () => {
		const events = [
			diagnostic(hostEvent("fn_call")),
			diagnostic(hostEvent("fn_return")),
		]

		expect(recordedEvent(events)).toBeUndefined()
	})
})

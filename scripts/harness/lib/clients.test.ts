import { xdr, type rpc } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { sentEvents, simulationEvents } from "./clients.js"

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

const diagnosticEvent = (event: xdr.ContractEvent) =>
	new xdr.DiagnosticEvent({ inSuccessfulContractCall: true, event })

describe("sentEvents", () => {
	it("flattens the included transaction's own contract events", () => {
		const first = contractEvent("one")
		const second = contractEvent("two")
		const getTransactionResponse = {
			events: { contractEventsXdr: [[first], [second]] },
		} as unknown as rpc.Api.GetTransactionResponse

		expect(sentEvents({ getTransactionResponse })).toEqual([first, second])
	})

	it("answers nothing without a getTransaction result", () => {
		expect(sentEvents({})).toEqual([])
	})

	it("answers nothing when the response carries no events", () => {
		const getTransactionResponse =
			{} as unknown as rpc.Api.GetTransactionResponse

		expect(sentEvents({ getTransactionResponse })).toEqual([])
	})
})

describe("simulationEvents", () => {
	it("unwraps the simulation's diagnostic events to their contract events", () => {
		const event = contractEvent("one")

		expect(
			simulationEvents({ simulation: { events: [diagnosticEvent(event)] } }),
		).toEqual([event])
	})

	it("answers nothing without a simulation", () => {
		expect(simulationEvents({})).toEqual([])
	})
})

import { describe, expect, it } from "vitest"

import { expectRefused, type HasSpec } from "./refused.js"

const errorCases = [
	{ name: () => ({ toString: () => "NoticeNotElapsed" }), value: () => 6010 },
	{ name: () => ({ toString: () => "PriceAvailable" }), value: () => 6011 },
]

const clientWith = (): HasSpec => ({
	spec: { errorCases: () => errorCases },
})

const refusedWith = (code: number) => ({
	result: undefined,
	simulation: { error: `HostError: Error(Contract, #${code})` },
})

describe("expectRefused", () => {
	it("passes when the call is refused with the named error", () => {
		expect(() =>
			expectRefused(refusedWith(6010), clientWith(), "NoticeNotElapsed"),
		).not.toThrow()
	})

	it("fails naming the outcome it got", () => {
		expect(() =>
			expectRefused(refusedWith(6011), clientWith(), "NoticeNotElapsed"),
		).toThrow(/refused: PriceAvailable/)
	})

	it("fails when the call was accepted", () => {
		expect(() =>
			expectRefused({ result: 1 }, clientWith(), "NoticeNotElapsed"),
		).toThrow(/accepted/)
	})

	it("stops on an error name the spec does not have", () => {
		expect(() =>
			expectRefused(refusedWith(6010), clientWith(), "Nope"),
		).toThrow("the contract spec has no error named Nope")
	})
})

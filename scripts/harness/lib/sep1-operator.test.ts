import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { readOperatorValues } from "./sep1-operator.js"

const ENV = { INIT_CWD: "/w" }

describe("readOperatorValues", () => {
	it("returns no values when SEP1_OPERATOR is unset", () => {
		expect(readOperatorValues({})).toEqual({})
	})

	it("resolves a relative path from INIT_CWD, not process.cwd()", () => {
		const values = readOperatorValues(
			{ ...ENV, SEP1_OPERATOR: "operator.json" },
			(path) => {
				expect(path).toBe("/w/operator.json")
				return JSON.stringify({ ORG_NAME: "Acme" })
			},
		)

		expect(values).toEqual({ ORG_NAME: "Acme" })
	})

	it("falls back to process.cwd() without INIT_CWD", () => {
		const values = readOperatorValues(
			{ SEP1_OPERATOR: "operator.json" },
			(path) => {
				expect(path).toBe(resolve(process.cwd(), "operator.json"))
				return "{}"
			},
		)

		expect(values).toEqual({})
	})

	it("names the file when its JSON is malformed", () => {
		expect(() =>
			readOperatorValues(
				{ ...ENV, SEP1_OPERATOR: "operator.json" },
				() => "{ not json",
			),
		).toThrow(/operator\.json/)
	})

	it("checks the parsed values the same as a direct call", () => {
		expect(() =>
			readOperatorValues({ ...ENV, SEP1_OPERATOR: "operator.json" }, () =>
				JSON.stringify({ nope: "y" }),
			),
		).toThrow(/nope/)
	})
})

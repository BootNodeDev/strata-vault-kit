import { Buffer } from "buffer"
import { describe, expect, it, vi } from "vitest"
import { errorName, errorNames } from "./contractErrors"
import { generatedSpecs } from "./contracts"

const errorCase = (name: string, value: number) => ({
	name: () => Buffer.from(name),
	value: () => value,
})

const spec = (...cases: ReturnType<typeof errorCase>[]) => ({
	errorCases: () => cases,
})

describe("errorNames", () => {
	it("merges the error cases of every spec by code", () => {
		const names = errorNames([
			spec(errorCase("InvalidAmount", 6007), errorCase("Paused", 1000)),
			spec(errorCase("NoRecord", 3006), errorCase("Paused", 1000)),
		])

		expect(names.get(6007)).toBe("InvalidAmount")
		expect(names.get(3006)).toBe("NoRecord")
		expect(names.get(1000)).toBe("Paused")
	})

	it("knows no name for a code no spec declares", () => {
		expect(errorNames([spec(errorCase("NoRecord", 3006))]).get(9999)).toBe(
			undefined,
		)
	})

	it("leaves a code two specs name differently unresolved and logs it", () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const names = errorNames([
				spec(errorCase("WindDownActive", 6046), errorCase("NoRecord", 3006)),
				spec(errorCase("AlreadyPriced", 6046), errorCase("Paused", 1000)),
			])

			expect(names.get(6046)).toBe(undefined)
			expect(names.get(3006)).toBe("NoRecord")
			expect(names.get(1000)).toBe("Paused")
			expect(logged).toHaveBeenCalledOnce()
			expect(logged.mock.calls[0]?.[0]).toMatch(
				/#6046.*WindDownActive.*AlreadyPriced.*regenerate the clients from the same contracts/,
			)
		} finally {
			logged.mockRestore()
		}
	})
})

describe("errorName", () => {
	it("names every error case of the generated clients, with no code named twice", () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const cases = generatedSpecs().flatMap((spec) => spec.errorCases())

			expect(cases.length).toBeGreaterThan(0)
			for (const errorCase of cases) {
				expect(errorName(errorCase.value())).toBe(errorCase.name().toString())
			}
			expect(logged).not.toHaveBeenCalled()
		} finally {
			logged.mockRestore()
		}
	})
})

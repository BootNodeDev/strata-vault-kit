import { expect } from "vitest"

interface ErrorCase {
	name(): { toString(): string }
	value(): number
}

export interface HasSpec {
	spec: { errorCases(): ErrorCase[] }
}

interface Tx {
	result: unknown
	simulation?: unknown
}

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/

// The code comes from the simulation error, not the spec's doc string:
// doc strings are not unique across error cases.
export function outcome(tx: Tx, client: HasSpec): string {
	const simulation = tx.simulation as { error?: string } | undefined
	const match = simulation?.error?.match(CONTRACT_ERROR)
	if (match === undefined || match === null) {
		try {
			void tx.result
		} catch (error) {
			return `failed: ${error instanceof Error ? error.message : String(error)}`
		}
		return "accepted"
	}
	const code = Number(match[1])
	const found = client.spec.errorCases().find((c) => c.value() === code)
	return `refused: ${found?.name().toString() ?? `#${code}`}`
}

export function expectRefused(tx: Tx, client: HasSpec, name: string): void {
	const known = client.spec
		.errorCases()
		.some((c) => c.name().toString() === name)
	if (!known) throw new Error(`the contract spec has no error named ${name}`)
	expect(outcome(tx, client)).toBe(`refused: ${name}`)
}

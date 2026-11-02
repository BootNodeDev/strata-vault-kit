import { generatedSpecs } from "./contracts"

interface ErrorCase {
	name(): { toString(): string }
	value(): number
}

export interface ErrorSpec {
	errorCases(): ErrorCase[]
}

export function errorNames(specs: ErrorSpec[]): Map<number, string> {
	const names = new Map<number, string>()
	const conflicting = new Set<number>()
	for (const spec of specs) {
		for (const errorCase of spec.errorCases()) {
			const code = errorCase.value()
			if (conflicting.has(code)) continue
			const name = errorCase.name().toString()
			const known = names.get(code)
			if (known !== undefined && known !== name) {
				console.error(
					`Contract error #${code} is ${known} in one generated client and ${name} in another; regenerate the clients from the same contracts`,
				)
				conflicting.add(code)
				names.delete(code)
				continue
			}
			names.set(code, name)
		}
	}
	return names
}

let generatedNames: Map<number, string> | undefined

export function errorName(code: number): string | undefined {
	generatedNames ??= errorNames(generatedSpecs())
	return generatedNames.get(code)
}

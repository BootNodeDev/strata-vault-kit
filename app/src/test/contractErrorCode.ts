export type ErrorTable = Record<number, { message: string }>

export function contractErrorCode(errors: ErrorTable, name: string): number {
	const codes = Object.entries(errors)
		.filter(([, error]) => error.message === name)
		.map(([code]) => Number(code))
	const [code, ...others] = codes
	if (code === undefined || others.length > 0) {
		throw new Error(
			`Expected one contract error named ${name} in the generated error table, found ${codes.length}`,
		)
	}
	return code
}

export const simulationError = (errors: ErrorTable, name: string) =>
	`HostError: Error(Contract, #${contractErrorCode(errors, name)})`

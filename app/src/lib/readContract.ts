export type ContractRead<T> =
	| { kind: "value"; value: T }
	| { kind: "contract-error"; code: number }
	| { kind: "unreadable" }

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/

function parseErrorCode(simulation: unknown): number | null {
	const error = (simulation as { error?: unknown } | null)?.error
	if (typeof error !== "string") return null
	const match = error.match(CONTRACT_ERROR)
	return match ? Number(match[1]) : null
}

export async function readContract<T>(
	call: () => Promise<{ simulation?: unknown; result: T }>,
): Promise<ContractRead<T>> {
	try {
		const tx = await call()
		const code = parseErrorCode(tx.simulation)
		return code !== null
			? { kind: "contract-error", code }
			: { kind: "value", value: tx.result }
	} catch {
		return { kind: "unreadable" }
	}
}

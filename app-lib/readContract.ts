import { Api } from "@stellar/stellar-sdk/rpc"

export type ContractRead<T> =
	| { kind: "value"; value: T }
	| { kind: "contract-error"; code: number }
	| { kind: "archived" }
	| { kind: "unreadable" }

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/

function parseErrorCode(
	simulation: Api.SimulateTransactionResponse | undefined,
): number | null {
	if (simulation === undefined || !Api.isSimulationError(simulation))
		return null
	const match = simulation.error.match(CONTRACT_ERROR)
	return match ? Number(match[1]) : null
}

export async function readContract<T>(
	call: () => Promise<{
		simulation?: Api.SimulateTransactionResponse
		result: T
	}>,
): Promise<ContractRead<T>> {
	try {
		const tx = await call()
		if (tx.simulation !== undefined && Api.isSimulationRestore(tx.simulation)) {
			return { kind: "archived" }
		}
		const code = parseErrorCode(tx.simulation)
		return code !== null
			? { kind: "contract-error", code }
			: { kind: "value", value: tx.result }
	} catch {
		return { kind: "unreadable" }
	}
}

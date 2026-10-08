import { Address, scValToNative, xdr } from "@stellar/stellar-sdk"
import { Api, Server } from "@stellar/stellar-sdk/rpc"
import type {
	DepositRequest,
	EpochInfo,
	EpochStatus,
	RedeemRequest,
} from "./contracts"
import { rpcUrl, stellarNetwork } from "./env"

export type ContractRead<T> =
	| { kind: "value"; value: T }
	| { kind: "contract-error"; code: number }
	| { kind: "archived" }
	| { kind: "unreadable" }

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/

export function parseErrorCode(
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

const server = new Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })

const EPOCHS_PER_LEDGER_ENTRIES_REQUEST = 66

const scvU64 = (value: bigint): xdr.ScVal =>
	xdr.ScVal.scvU64(xdr.Uint64.fromString(value.toString()))

const epochDataKey = (epochId: bigint): xdr.ScVal =>
	xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Epoch"), scvU64(epochId)])

const userRequestDataKey = (
	variant: "UserDeposit" | "UserRedeem",
	epochId: bigint,
	controller: xdr.ScVal,
): xdr.ScVal =>
	xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), scvU64(epochId), controller])

const contractDataLedgerKey = (
	contract: xdr.ScAddress,
	key: xdr.ScVal,
): xdr.LedgerKey =>
	xdr.LedgerKey.contractData(
		new xdr.LedgerKeyContractData({
			contract,
			key,
			durability: xdr.ContractDataDurability.persistent(),
		}),
	)

type EpochKeySet = {
	epochId: bigint
	epoch: xdr.LedgerKey
	deposit: xdr.LedgerKey
	redeem: xdr.LedgerKey
}

const epochKeySets = (
	contract: xdr.ScAddress,
	controller: xdr.ScVal,
	epochIds: bigint[],
): EpochKeySet[] =>
	epochIds.map((epochId) => ({
		epochId,
		epoch: contractDataLedgerKey(contract, epochDataKey(epochId)),
		deposit: contractDataLedgerKey(
			contract,
			userRequestDataKey("UserDeposit", epochId, controller),
		),
		redeem: contractDataLedgerKey(
			contract,
			userRequestDataKey("UserRedeem", epochId, controller),
		),
	}))

const chunk = <T>(items: T[], size: number): T[][] => {
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size)
		chunks.push(items.slice(i, i + size))
	return chunks
}

type ChunkFetch =
	{ ok: true; byKey: Map<string, Api.LedgerEntryResult> } | { ok: false }

async function fetchChunk(keys: xdr.LedgerKey[]): Promise<ChunkFetch> {
	try {
		const response = await server.getLedgerEntries(...keys)
		const byKey = new Map<string, Api.LedgerEntryResult>()
		for (const entry of response.entries)
			byKey.set(entry.key.toXDR("base64"), entry)
		return { ok: true, byKey }
	} catch {
		return { ok: false }
	}
}

function decodeLedgerEntry<T>(
	chunkResult: ChunkFetch,
	key: xdr.LedgerKey,
	decode: (val: xdr.ScVal) => T,
	latestLedger: number | null,
): ContractRead<T | null> {
	if (!chunkResult.ok) return { kind: "unreadable" }
	const entry = chunkResult.byKey.get(key.toXDR("base64"))
	if (entry === undefined) return { kind: "value", value: null }
	if (latestLedger === null) return { kind: "unreadable" }
	if ((entry.liveUntilLedgerSeq ?? 0) < latestLedger)
		return { kind: "archived" }
	try {
		return { kind: "value", value: decode(entry.val.contractData().val()) }
	} catch {
		return { kind: "unreadable" }
	}
}

const decodeEpochStatus = (raw: unknown): EpochStatus => {
	const [tag] = raw as [EpochStatus["tag"]]
	return { tag, values: undefined }
}

const decodeEpochInfo = (val: xdr.ScVal): EpochInfo => {
	const raw = scValToNative(val) as Omit<EpochInfo, "status"> & {
		status: unknown
	}
	return { ...raw, status: decodeEpochStatus(raw.status) }
}

export type EpochRequestsRead = {
	epoch: ContractRead<EpochInfo | null>
	deposit: ContractRead<DepositRequest | null>
	redeem: ContractRead<RedeemRequest | null>
}

export async function readEpochRequests(
	contractId: string,
	controller: string,
	epochIds: bigint[],
): Promise<Map<bigint, EpochRequestsRead>> {
	const results = new Map<bigint, EpochRequestsRead>()
	if (epochIds.length === 0) return results

	const contract = Address.fromString(contractId).toScAddress()
	const controllerScVal = Address.fromString(controller).toScVal()
	const chunks = chunk(
		epochKeySets(contract, controllerScVal, epochIds),
		EPOCHS_PER_LEDGER_ENTRIES_REQUEST,
	)

	const [latestLedger, resolvedChunks] = await Promise.all([
		server
			.getLatestLedger()
			.then((response) => response.sequence)
			.catch(() => null),
		Promise.all(
			chunks.map(async (keySetChunk) => ({
				keySetChunk,
				chunkResult: await fetchChunk(
					keySetChunk.flatMap((set) => [set.epoch, set.deposit, set.redeem]),
				),
			})),
		),
	])

	for (const { keySetChunk, chunkResult } of resolvedChunks) {
		for (const set of keySetChunk) {
			results.set(set.epochId, {
				epoch: decodeLedgerEntry<EpochInfo>(
					chunkResult,
					set.epoch,
					decodeEpochInfo,
					latestLedger,
				),
				deposit: decodeLedgerEntry<DepositRequest>(
					chunkResult,
					set.deposit,
					scValToNative,
					latestLedger,
				),
				redeem: decodeLedgerEntry<RedeemRequest>(
					chunkResult,
					set.redeem,
					scValToNative,
					latestLedger,
				),
			})
		}
	}

	return results
}

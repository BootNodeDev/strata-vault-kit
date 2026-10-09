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

const LEDGER_ENTRIES_PER_REQUEST = 200
const REQUEST_KEYS_PER_EPOCH = 3
const EPOCHS_PER_LEDGER_ENTRIES_REQUEST = Math.floor(
	LEDGER_ENTRIES_PER_REQUEST / REQUEST_KEYS_PER_EPOCH,
)
const EVENTS_PAGE_SIZE = 200
const MAX_EVENT_PAGES = 25

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

const latestLedgerSequence = (): Promise<number | null> =>
	server
		.getLatestLedger()
		.then((response) => response.sequence)
		.catch(() => null)

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
		latestLedgerSequence(),
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

export async function readEpochs(
	contractId: string,
	epochIds: bigint[],
): Promise<Map<bigint, ContractRead<EpochInfo | null>>> {
	const results = new Map<bigint, ContractRead<EpochInfo | null>>()
	if (epochIds.length === 0) return results

	const contract = Address.fromString(contractId).toScAddress()
	const keyed = epochIds.map((epochId) => ({
		epochId,
		key: contractDataLedgerKey(contract, epochDataKey(epochId)),
	}))

	const [latestLedger, resolvedChunks] = await Promise.all([
		latestLedgerSequence(),
		Promise.all(
			chunk(keyed, LEDGER_ENTRIES_PER_REQUEST).map(async (keyedChunk) => ({
				keyedChunk,
				chunkResult: await fetchChunk(keyedChunk.map(({ key }) => key)),
			})),
		),
	])

	for (const { keyedChunk, chunkResult } of resolvedChunks) {
		for (const { epochId, key } of keyedChunk) {
			results.set(
				epochId,
				decodeLedgerEntry<EpochInfo>(
					chunkResult,
					key,
					decodeEpochInfo,
					latestLedger,
				),
			)
		}
	}

	return results
}

export async function readLedgerTime(): Promise<bigint | null> {
	try {
		const { closeTime } = await server.getLatestLedger()
		return BigInt(closeTime)
	} catch {
		return null
	}
}

export type EventSelection = { contractId: string; names: string[] }

export type ChainEvent = {
	contractId: string
	name: string
	topics: unknown[]
	data: unknown
	ledger: number
	closedAt: bigint
}

const toEventFilter = ({
	contractId,
	names,
}: EventSelection): Api.EventFilter => ({
	type: "contract",
	contractIds: [contractId],
	topics: names.map((name) => [xdr.ScVal.scvSymbol(name).toXDR("base64"), "*"]),
})

const decodeEvent = (event: Api.EventResponse): ChainEvent | null => {
	try {
		const [name, ...topics] = event.topic.map((topic) => scValToNative(topic))
		if (typeof name !== "string" || event.contractId === undefined) return null
		return {
			contractId: event.contractId.contractId(),
			name,
			topics,
			data: scValToNative(event.value),
			ledger: event.ledger,
			closedAt: BigInt(Math.floor(Date.parse(event.ledgerClosedAt) / 1000)),
		}
	} catch {
		return null
	}
}

export type EventsRead =
	| { kind: "value"; value: ChainEvent[]; partial: boolean }
	| { kind: "unreadable" }

export async function readEvents(
	selections: EventSelection[],
	windowLedgers: number,
): Promise<EventsRead> {
	try {
		const { latestLedger, oldestLedger } = await server.getHealth()
		const filters = selections.map(toEventFilter)
		let request: Api.GetEventsRequest = {
			filters,
			startLedger: Math.max(latestLedger - windowLedgers, oldestLedger),
			limit: EVENTS_PAGE_SIZE,
		}

		const events: ChainEvent[] = []
		for (let page = 0; page < MAX_EVENT_PAGES; page++) {
			const response = await server.getEvents(request)
			for (const raw of response.events) {
				const event = decodeEvent(raw)
				if (event !== null) events.push(event)
			}
			if (response.events.length < EVENTS_PAGE_SIZE)
				return { kind: "value", value: events, partial: false }
			request = { filters, cursor: response.cursor, limit: EVENTS_PAGE_SIZE }
		}
		return { kind: "value", value: events, partial: true }
	} catch {
		return { kind: "unreadable" }
	}
}

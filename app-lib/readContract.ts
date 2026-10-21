import { Address, scValToNative, xdr } from "@stellar/stellar-sdk"
import { Api } from "@stellar/stellar-sdk/rpc"
import type {
	DepositRequest,
	EpochInfo,
	EpochStatus,
	RedeemRequest,
} from "./contracts"
import { server } from "./rpc"

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
	durability = xdr.ContractDataDurability.persistent(),
): xdr.LedgerKey =>
	xdr.LedgerKey.contractData(
		new xdr.LedgerKeyContractData({ contract, key, durability }),
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

// The RPC reports the close time, but the SDK's response type omits it.
type Health = Api.GetHealthResponse & { latestLedgerCloseTime?: string }

const readHealth = (): Promise<Health> => server.getHealth()

type ChunkFetch =
	| {
			ok: true
			byKey: Map<string, Api.LedgerEntryResult>
			latestLedger: number
	  }
	| { ok: false }

async function fetchChunk(keys: xdr.LedgerKey[]): Promise<ChunkFetch> {
	try {
		const response = await server.getLedgerEntries(...keys)
		const byKey = new Map<string, Api.LedgerEntryResult>()
		for (const entry of response.entries)
			byKey.set(entry.key.toXDR("base64"), entry)
		return { ok: true, byKey, latestLedger: response.latestLedger }
	} catch {
		return { ok: false }
	}
}

function decodeLedgerEntry<T>(
	chunkResult: ChunkFetch,
	key: xdr.LedgerKey,
	decode: (val: xdr.ScVal) => T,
	untrackedTtlIsLive = false,
): ContractRead<T | null> {
	if (!chunkResult.ok) return { kind: "unreadable" }
	const entry = chunkResult.byKey.get(key.toXDR("base64"))
	if (entry === undefined) return { kind: "value", value: null }
	const liveUntil = entry.liveUntilLedgerSeq ?? 0
	if (
		liveUntil < chunkResult.latestLedger &&
		!(untrackedTtlIsLive && liveUntil === 0)
	)
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

	const resolvedChunks = await Promise.all(
		chunks.map(async (keySetChunk) => ({
			keySetChunk,
			chunkResult: await fetchChunk(
				keySetChunk.flatMap((set) => [set.epoch, set.deposit, set.redeem]),
			),
		})),
	)

	for (const { keySetChunk, chunkResult } of resolvedChunks) {
		for (const set of keySetChunk) {
			results.set(set.epochId, {
				epoch: decodeLedgerEntry<EpochInfo>(
					chunkResult,
					set.epoch,
					decodeEpochInfo,
				),
				deposit: decodeLedgerEntry<DepositRequest>(
					chunkResult,
					set.deposit,
					scValToNative,
				),
				redeem: decodeLedgerEntry<RedeemRequest>(
					chunkResult,
					set.redeem,
					scValToNative,
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

	const resolvedChunks = await Promise.all(
		chunk(keyed, LEDGER_ENTRIES_PER_REQUEST).map(async (keyedChunk) => ({
			keyedChunk,
			chunkResult: await fetchChunk(keyedChunk.map(({ key }) => key)),
		})),
	)

	for (const { keyedChunk, chunkResult } of resolvedChunks) {
		for (const { epochId, key } of keyedChunk) {
			results.set(
				epochId,
				decodeLedgerEntry<EpochInfo>(chunkResult, key, decodeEpochInfo),
			)
		}
	}

	return results
}

export async function readLedgerTime(): Promise<bigint | null> {
	try {
		const { latestLedgerCloseTime } = await readHealth()
		return latestLedgerCloseTime === undefined
			? null
			: BigInt(latestLedgerCloseTime)
	} catch {
		return null
	}
}

export type PendingTransfer = {
	address: string
	liveUntilLedger: number
	expired: boolean
}

export type LedgerWindow = {
	sequence: number
	closeTime: bigint
	maxLiveUntil: number | null
}

export type PendingAdmins = {
	ledger: LedgerWindow
	pending: Map<string, PendingTransfer | null>
}

const pendingAdminKey = (contractId: string): xdr.LedgerKey =>
	contractDataLedgerKey(
		Address.fromString(contractId).toScAddress(),
		xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("PendingAdmin")]),
		xdr.ContractDataDurability.temporary(),
	)

const archivalSettingsKey = (): xdr.LedgerKey =>
	xdr.LedgerKey.configSetting(
		new xdr.LedgerKeyConfigSetting({
			configSettingId: xdr.ConfigSettingId.configSettingStateArchival(),
		}),
	)

const isPendingTransfer = (
	value: unknown,
): value is { address: string; live_until_ledger: number } =>
	typeof value === "object" &&
	value !== null &&
	"address" in value &&
	typeof value.address === "string" &&
	"live_until_ledger" in value &&
	typeof value.live_until_ledger === "number"

const decodePendingTransfer =
	(sequence: number) =>
	(val: xdr.ScVal): PendingTransfer => {
		const native: unknown = scValToNative(val)
		if (!isPendingTransfer(native)) throw new Error("malformed pending admin")
		return {
			address: native.address,
			liveUntilLedger: native.live_until_ledger,
			expired: sequence > native.live_until_ledger,
		}
	}

const maxLiveUntil = (
	settings: Api.LedgerEntryResult | undefined,
	sequence: number,
): number | null =>
	settings === undefined
		? null
		: sequence +
			settings.val.configSetting().stateArchivalSettings().maxEntryTtl() -
			1

export async function readPendingAdmins(
	contractIds: string[],
): Promise<ContractRead<PendingAdmins>> {
	const keyed = contractIds.map((contractId) => ({
		contractId,
		key: pendingAdminKey(contractId),
	}))
	const archival = archivalSettingsKey()
	try {
		const [health, fetched] = await Promise.all([
			readHealth(),
			fetchChunk([...keyed.map(({ key }) => key), archival]),
		])
		const { latestLedger: sequence, latestLedgerCloseTime } = health
		if (!fetched.ok || latestLedgerCloseTime === undefined)
			return { kind: "unreadable" }
		const pending = new Map<string, PendingTransfer | null>()
		for (const { contractId, key } of keyed) {
			const read = decodeLedgerEntry(
				fetched,
				key,
				decodePendingTransfer(sequence),
			)
			if (read.kind !== "value" && read.kind !== "archived")
				return { kind: "unreadable" }
			pending.set(contractId, read.kind === "value" ? read.value : null)
		}
		return {
			kind: "value",
			value: {
				ledger: {
					sequence,
					closeTime: BigInt(latestLedgerCloseTime),
					maxLiveUntil: maxLiveUntil(
						fetched.byKey.get(archival.toXDR("base64")),
						sequence,
					),
				},
				pending,
			},
		}
	} catch {
		return { kind: "unreadable" }
	}
}

const contractInstanceKey = (contractId: string): xdr.LedgerKey =>
	contractDataLedgerKey(
		Address.fromString(contractId).toScAddress(),
		xdr.ScVal.scvLedgerKeyContractInstance(),
	)

const ADMIN_KEY = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Admin")]).toXDR(
	"base64",
)

const decodeInstanceAdmin = (val: xdr.ScVal): string | null => {
	const entry = val
		.instance()
		.storage()
		?.find((candidate) => candidate.key().toXDR("base64") === ADMIN_KEY)
	if (entry === undefined) return null
	const admin: unknown = scValToNative(entry.val())
	if (typeof admin !== "string") throw new Error("malformed admin")
	return admin
}

export async function readContractAdmin(
	contractId: string,
): Promise<ContractRead<string | null>> {
	try {
		const key = contractInstanceKey(contractId)
		return decodeLedgerEntry(
			await fetchChunk([key]),
			key,
			decodeInstanceAdmin,
			true,
		)
	} catch {
		return { kind: "unreadable" }
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
		const { latestLedger, oldestLedger } = await readHealth()
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

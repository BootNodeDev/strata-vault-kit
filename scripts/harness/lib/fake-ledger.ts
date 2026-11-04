import { Address, Networks, StrKey, xdr } from "@stellar/stellar-sdk"

import { type Rpc } from "./cli.js"
import { type Entry, type Runner } from "./ttl.js"

export const RPC: Rpc = {
	rpcUrl: "http://localhost:8000/rpc",
	passphrase: Networks.STANDALONE,
}

export const CONTRACT_A = StrKey.encodeContract(Buffer.alloc(32, 1))
export const CONTRACT_B = StrKey.encodeContract(Buffer.alloc(32, 2))
export const CONTRACT_C = StrKey.encodeContract(Buffer.alloc(32, 3))

export const WASM_HASH = Buffer.alloc(32, 0x11).toString("hex")

function contractDataXdr(
	contractId: string,
	key: xdr.ScVal,
	val: xdr.ScVal,
): string {
	const entry = new xdr.ContractDataEntry({
		ext: new xdr.ExtensionPoint(0),
		contract: new Address(contractId).toScAddress(),
		key,
		durability: xdr.ContractDataDurability.persistent(),
		val,
	})
	return xdr.LedgerEntryData.contractData(entry).toXDR("base64")
}

/** A base64 `LedgerEntryData` for a contract instance, Wasm or a Stellar asset. */
export function instanceData(
	contractId: string,
	opts: { wasmHash?: string; storage?: xdr.ScMapEntry[] },
): string {
	const executable =
		opts.wasmHash !== undefined
			? xdr.ContractExecutable.contractExecutableWasm(
					Buffer.from(opts.wasmHash, "hex"),
				)
			: xdr.ContractExecutable.contractExecutableStellarAsset()
	const instance = new xdr.ScContractInstance({
		executable,
		storage: opts.storage ?? null,
	})
	return contractDataXdr(
		contractId,
		xdr.ScVal.scvLedgerKeyContractInstance(),
		xdr.ScVal.scvContractInstance(instance),
	)
}

/** A base64 `LedgerEntryData` for a contract's Wasm. */
export function codeData(wasmHash: string): string {
	const entry = new xdr.ContractCodeEntry({
		ext: new xdr.ContractCodeEntryExt(0),
		hash: Buffer.from(wasmHash, "hex"),
		code: Buffer.alloc(0),
	})
	return xdr.LedgerEntryData.contractCode(entry).toXDR("base64")
}

/** A base64 `LedgerEntryData` for a pending timelock change, under its key. */
export function pendingData(contractId: string, keyXdr: string): string {
	return contractDataXdr(
		contractId,
		xdr.ScVal.fromXDR(keyXdr, "base64"),
		xdr.ScVal.scvVoid(),
	)
}

/** The RPC `getLedgerEntries` JSON shape the CLI's `--output xdr` prints. */
export function fetchOutput(
	latestLedger: number,
	entries: Array<{ xdr: string; liveUntilLedgerSeq: number }>,
): string {
	return JSON.stringify({
		entries: entries.map((entry) => ({
			key: "",
			xdr: entry.xdr,
			lastModifiedLedgerSeq: latestLedger,
			liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
		})),
		latestLedger,
	})
}

export function entryKey(entry: Entry): string {
	if ("wasmHash" in entry) return `code:${entry.wasmHash}`
	if ("keyXdr" in entry) return `data:${entry.id}:${entry.keyXdr}`
	return `instance:${entry.id}`
}

function flagValue(args: string[], flag: string): string | undefined {
	const at = args.indexOf(flag)
	return at === -1 ? undefined : args[at + 1]
}

function entryFromArgs(args: string[]): Entry {
	const wasmHash = flagValue(args, "--wasm-hash")
	if (wasmHash !== undefined) return { wasmHash }
	const id = flagValue(args, "--contract") ?? flagValue(args, "--id")
	if (id === undefined)
		throw new Error(`unexpected stellar call: ${args.join(" ")}`)
	const keyXdr = flagValue(args, "--key-xdr")
	return keyXdr !== undefined ? { id, keyXdr } : { id }
}

interface LedgerRecord {
	data: string
	liveUntil: number
	whenArchived: "absent" | "expired"
}

/** An in-memory ledger a `Runner` reads and writes, standing in for the CLI. */
export class FakeLedger {
	calls: string[][] = []
	restoreDoesNothing = false
	run: Runner = (args) => this.handle([...args])

	private readonly entries = new Map<string, LedgerRecord>()

	constructor(private readonly latest = 1000) {}

	put(
		key: string,
		data: string,
		liveUntil: number,
		whenArchived: "absent" | "expired" = "expired",
	): void {
		this.entries.set(key, { data, liveUntil, whenArchived })
	}

	private handle(args: string[]): Promise<string> {
		this.calls.push(args)
		const [group, action] = args
		if (group === "ledger" && action === "latest")
			return Promise.resolve(JSON.stringify({ sequence: this.latest }))
		if (group === "ledger" && action === "entry")
			return Promise.resolve(this.fetch(args))
		if (group === "contract" && action === "restore")
			return Promise.resolve(this.restore(args))
		if (group === "contract" && action === "extend")
			return Promise.resolve(this.extend(args))
		throw new Error(`unexpected stellar call: ${args.join(" ")}`)
	}

	private fetch(args: string[]): string {
		const record = this.entries.get(entryKey(entryFromArgs(args)))
		if (record === undefined) return fetchOutput(this.latest, [])
		if (record.liveUntil < this.latest) {
			return record.whenArchived === "absent"
				? fetchOutput(this.latest, [])
				: fetchOutput(this.latest, [
						{ xdr: record.data, liveUntilLedgerSeq: 0 },
					])
		}
		return fetchOutput(this.latest, [
			{ xdr: record.data, liveUntilLedgerSeq: record.liveUntil },
		])
	}

	private restore(args: string[]): string {
		const record = this.entries.get(entryKey(entryFromArgs(args)))
		if (record === undefined) {
			throw new Error(
				"stellar failed (exit 1):\n❌ error: transaction simulation failed: Missing entry to restore",
			)
		}
		if (!this.restoreDoesNothing) record.liveUntil = this.latest + 20
		return ""
	}

	private extend(args: string[]): string {
		const record = this.entries.get(entryKey(entryFromArgs(args)))
		if (record === undefined || record.liveUntil < this.latest) return "0"
		const ledgers = Number(flagValue(args, "--ledgers-to-extend"))
		record.liveUntil = Math.max(record.liveUntil, this.latest + ledgers)
		return String(record.liveUntil)
	}
}

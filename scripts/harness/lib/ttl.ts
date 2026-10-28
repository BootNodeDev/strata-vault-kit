import { rpcArgs, stellar, type Rpc } from "./cli.js"

/** Thirty days of five-second ledgers: the same length the contracts extend to on use. */
export const EXTEND_LEDGERS = 30 * 17_280

export type Entry = { id: string } | { wasmHash: string } | PendingEntry

/** A specific persistent entry in a contract's own storage, by its key. */
export interface PendingEntry {
	id: string
	keyXdr: string
}

const entryArgs = (entry: Entry): string[] =>
	"keyXdr" in entry
		? ["--id", entry.id, "--key-xdr", entry.keyXdr]
		: "id" in entry
			? ["--id", entry.id]
			: ["--wasm-hash", entry.wasmHash]

interface FetchedEntries {
	entries: Array<{
		liveUntilLedgerSeq: number
		val: {
			contract_data?: {
				val: {
					contract_instance?: { executable: { wasm: string } | string }
				}
			}
		}
	}>
}

export async function latestLedger(rpc: Rpc): Promise<number> {
	const out = await stellar([
		"ledger",
		"latest",
		"--output",
		"json",
		...rpcArgs(rpc),
	])
	return (JSON.parse(out) as { sequence: number }).sequence
}

/**
 * The ledger the entry lives until, zero once archived, and for an instance
 * the hash of the Wasm it runs. A Stellar Asset Contract runs no Wasm.
 */
export async function inspect(
	rpc: Rpc,
	entry: Entry,
): Promise<{ liveUntil: number; wasmHash: string | undefined }> {
	const args =
		"keyXdr" in entry
			? ["contract-data", "--contract", entry.id, "--key-xdr", entry.keyXdr]
			: "id" in entry
				? ["contract-data", "--contract", entry.id, "--instance"]
				: ["contract-code", "--wasm-hash", entry.wasmHash]
	const out = await stellar([
		"ledger",
		"entry",
		"fetch",
		...args,
		"--output",
		"json",
		...rpcArgs(rpc),
	])
	const [found] = (JSON.parse(out) as FetchedEntries).entries
	if (found === undefined)
		throw new Error(`no ledger entry for ${JSON.stringify(entry)}`)
	const executable = found.val.contract_data?.val.contract_instance?.executable
	return {
		liveUntil: found.liveUntilLedgerSeq,
		wasmHash: typeof executable === "object" ? executable.wasm : undefined,
	}
}

// The CLI pays with the account in STELLAR_ACCOUNT, inherited from the caller.
export async function restore(rpc: Rpc, entry: Entry): Promise<void> {
	await stellar(["contract", "restore", ...entryArgs(entry), ...rpcArgs(rpc)])
}

/** Returns the ledger the entry now lives until. */
export async function extend(
	rpc: Rpc,
	entry: Entry,
	ledgers: number,
): Promise<number> {
	const out = await stellar([
		"contract",
		"extend",
		...entryArgs(entry),
		"--ledgers-to-extend",
		String(ledgers),
		"--ttl-ledger-only",
		...rpcArgs(rpc),
	])
	return Number(out.split("\n").at(-1))
}

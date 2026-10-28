import { xdr } from "@stellar/stellar-sdk"

import { rpcArgs, stellar, type Rpc } from "./cli.js"

/** Thirty days of five-second ledgers: the same length the contracts extend to on use. */
export const EXTEND_LEDGERS = 30 * 17_280

export type Entry = { id: string } | { wasmHash: string } | PendingEntry

/** A specific persistent entry in a contract's own storage, by its key. */
export interface PendingEntry {
	id: string
	keyXdr: string
}

export type Runner = (args: readonly string[]) => Promise<string>

/** What a ledger entry fetch found: live or archived, and its instance if any. */
export interface Inspection {
	archived: boolean
	found: boolean
	instance: xdr.ScContractInstance | undefined
}

const entryArgs = (entry: Entry): string[] =>
	"keyXdr" in entry
		? ["--id", entry.id, "--key-xdr", entry.keyXdr]
		: "id" in entry
			? ["--id", entry.id]
			: ["--wasm-hash", entry.wasmHash]

function fetchError(out: string): Error {
	return new Error(
		`stellar ledger entry fetch returned unexpected output:\n${out}`,
	)
}

/** The instance for a plain `{ id }` fetch, or `undefined` for the other entry kinds. */
function instanceOf(
	entry: Entry,
	decoded: xdr.LedgerEntryData,
	out: string,
): xdr.ScContractInstance | undefined {
	if ("wasmHash" in entry) {
		if (decoded.switch().name !== "contractCode") throw fetchError(out)
		return undefined
	}
	if (decoded.switch().name !== "contractData") throw fetchError(out)
	if ("keyXdr" in entry) return undefined
	const val = decoded.contractData().val()
	if (val.switch().name !== "scvContractInstance") throw fetchError(out)
	return val.instance()
}

export async function inspect(
	rpc: Rpc,
	entry: Entry,
	run: Runner = stellar,
): Promise<Inspection> {
	const args =
		"keyXdr" in entry
			? ["contract-data", "--contract", entry.id, "--key-xdr", entry.keyXdr]
			: "id" in entry
				? ["contract-data", "--contract", entry.id, "--instance"]
				: ["contract-code", "--wasm-hash", entry.wasmHash]
	const out = await run([
		"ledger",
		"entry",
		"fetch",
		...args,
		"--output",
		"xdr",
		...rpcArgs(rpc),
	])

	let parsed: unknown
	try {
		parsed = JSON.parse(out)
	} catch {
		throw fetchError(out)
	}
	if (typeof parsed !== "object" || parsed === null) throw fetchError(out)
	const { entries, latestLedger } = parsed as Record<string, unknown>
	if (!Array.isArray(entries) || typeof latestLedger !== "number")
		throw fetchError(out)
	if (entries.length === 0)
		return { archived: true, found: false, instance: undefined }
	if (entries.length > 1) throw fetchError(out)

	const [found] = entries as unknown[]
	if (typeof found !== "object" || found === null) throw fetchError(out)
	const { xdr: entryXdr, liveUntilLedgerSeq } = found as Record<string, unknown>
	if (typeof entryXdr !== "string" || typeof liveUntilLedgerSeq !== "number")
		throw fetchError(out)

	let decoded: xdr.LedgerEntryData
	try {
		decoded = xdr.LedgerEntryData.fromXDR(entryXdr, "base64")
	} catch {
		throw fetchError(out)
	}

	return {
		archived: liveUntilLedgerSeq < latestLedger,
		found: true,
		instance: instanceOf(entry, decoded, out),
	}
}

// The CLI pays with the account in STELLAR_ACCOUNT, inherited from the caller.
export async function restore(
	rpc: Rpc,
	entry: Entry,
	run: Runner = stellar,
): Promise<void> {
	await run(["contract", "restore", ...entryArgs(entry), ...rpcArgs(rpc)])
}

/** Returns the ledger the entry now lives until. */
export async function extend(
	rpc: Rpc,
	entry: Entry,
	ledgers: number,
	run: Runner = stellar,
): Promise<number> {
	const out = await run([
		"contract",
		"extend",
		...entryArgs(entry),
		"--ledgers-to-extend",
		String(ledgers),
		"--ttl-ledger-only",
		...rpcArgs(rpc),
	])
	const last = out.split("\n").at(-1) ?? ""
	if (!/^\d+$/.test(last.trim())) {
		throw new Error(
			`stellar contract extend printed no live-until ledger:\n${out}`,
		)
	}
	const until = Number(last)
	if (until === 0) {
		throw new Error(
			"the entry is still archived; stellar contract extend made no change",
		)
	}
	return until
}

export async function latestLedger(
	rpc: Rpc,
	run: Runner = stellar,
): Promise<number> {
	const out = await run([
		"ledger",
		"latest",
		"--output",
		"json",
		...rpcArgs(rpc),
	])
	const badOutput = () =>
		new Error(`stellar ledger latest returned no ledger sequence:\n${out}`)

	let parsed: unknown
	try {
		parsed = JSON.parse(out)
	} catch {
		throw badOutput()
	}
	const sequence =
		typeof parsed === "object" && parsed !== null
			? (parsed as { sequence?: unknown }).sequence
			: undefined
	if (
		typeof sequence !== "number" ||
		!Number.isInteger(sequence) ||
		sequence <= 0
	)
		throw badOutput()
	return sequence
}

/** The hex Wasm hash an instance runs, or `undefined` for a Stellar Asset Contract. */
export function wasmHashOf(
	instance: xdr.ScContractInstance,
): string | undefined {
	const executable = instance.executable()
	return executable.switch().name === "contractExecutableWasm"
		? executable.wasmHash().toString("hex")
		: undefined
}

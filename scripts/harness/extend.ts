import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { xdr } from "@stellar/stellar-sdk"

import {
	contractIds,
	networkOf,
	selectedEnvironment,
} from "../lib/environments.mjs"

import { rpcArgs, stellar, type Rpc } from "./lib/cli.js"
import { REPO_ROOT } from "./lib/deployment.js"
import {
	EXTEND_LEDGERS,
	extend,
	inspect,
	latestLedger,
	restore,
	type Entry,
} from "./lib/ttl.js"

// Restores whatever has been archived, then extends every contract instance
// and the Wasm it runs, so an idle deployment stays callable. Extending needs
// no authority: any funded account pays.

interface DeploymentRecord {
	contracts: Record<string, string>
	asset?: { contract: string }
}

// Contracts whose storage holds a timelock change queue, by the name they
// deploy under.
const CONTRACTS_WITH_QUEUES = new Set([
	"async_vault",
	"share_token",
	"nav_oracle",
	"compliance",
])

/**
 * The timelock's own storage key for a change still waiting:
 * `Key::TimelockPending(id)`, a contracttype variant whose ScVal is a vec of
 * its symbol and the id (`crates/timelock/src/keys.rs`, `queue.rs`).
 */
function pendingChangeKey(id: number): string {
	return xdr.ScVal.scvVec([
		xdr.ScVal.scvSymbol("TimelockPending"),
		xdr.ScVal.scvU32(id),
	]).toXDR("base64")
}

/** The ids still waiting in a contract's queue, read through its `pending_changes` view. */
async function openChangeIds(rpc: Rpc, contractId: string): Promise<number[]> {
	const out = await stellar([
		"contract",
		"invoke",
		"--id",
		contractId,
		"--send",
		"no",
		...rpcArgs(rpc),
		"--",
		"pending_changes",
	])
	return (JSON.parse(out) as Array<{ id: number }>).map(({ id }) => id)
}

function option(flag: string): string | undefined {
	const at = process.argv.indexOf(flag)
	return at === -1 ? undefined : process.argv[at + 1]
}

function target(): { rpc: Rpc; contracts: Array<[string, string]> } {
	const toml = readFileSync(join(REPO_ROOT, "environments.toml"), "utf8")
	const environment = option("--env") ?? selectedEnvironment(process.env)
	const { rpcUrl, networkPassphrase } = networkOf(toml, environment)
	const rpc = { rpcUrl, passphrase: networkPassphrase }

	const config = option("--config")
	if (config === undefined) {
		const ids = contractIds(toml, environment)
		return { rpc, contracts: ids.map(({ name, id }) => [name, id]) }
	}
	// npm runs workspace scripts from the workspace; resolve from where it was called.
	const path = resolve(process.env["INIT_CWD"] ?? process.cwd(), config)
	const record = JSON.parse(readFileSync(path, "utf8")) as DeploymentRecord
	const contracts = Object.entries(record.contracts)
	if (record.asset !== undefined)
		contracts.push(["asset", record.asset.contract])
	return { rpc, contracts }
}

async function keepAlive(
	rpc: Rpc,
	entry: Entry,
	label: string,
	latest: number,
): Promise<string | undefined> {
	const before = await inspect(rpc, entry)
	if (before.liveUntil < latest) {
		await restore(rpc, entry)
		console.log(`${label} restored`)
	}
	const until = await extend(rpc, entry, EXTEND_LEDGERS)
	console.log(`${label} live until ledger ${until}`)
	return before.wasmHash
}

async function main(): Promise<void> {
	if (!process.env["STELLAR_ACCOUNT"])
		throw new Error(
			"set STELLAR_ACCOUNT to a funded account: a stellar CLI identity name or a secret key",
		)
	const { rpc, contracts } = target()
	const latest = await latestLedger(rpc)
	console.log(
		`extending ${contracts.length} contracts, latest ledger ${latest}`,
	)

	const code = new Set<string>()
	for (const [name, id] of contracts) {
		const wasmHash = await keepAlive(rpc, { id }, `${name} instance`, latest)
		if (wasmHash !== undefined) code.add(wasmHash)
	}
	for (const wasmHash of code) {
		await keepAlive(rpc, { wasmHash }, `code ${wasmHash.slice(0, 8)}`, latest)
	}
	// Reading a queue simulates a call, so the instance and its Wasm come first.
	for (const [name, id] of contracts) {
		if (!CONTRACTS_WITH_QUEUES.has(name)) continue
		for (const changeId of await openChangeIds(rpc, id)) {
			await keepAlive(
				rpc,
				{ id, keyXdr: pendingChangeKey(changeId) },
				`${name} pending change ${changeId}`,
				latest,
			)
		}
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})

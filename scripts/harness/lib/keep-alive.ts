import { type xdr } from "@stellar/stellar-sdk"

import { stellar, type Rpc } from "./cli.js"
import { openChangeIds, pendingChangeKey } from "./timelock-keys.js"
import {
	EXTEND_LEDGERS,
	extend,
	inspect,
	restore,
	wasmHashOf,
	type Entry,
	type Runner,
} from "./ttl.js"

export type Log = (line: string) => void

/** Restores `entry` if archived, then extends it, returning its instance if any. */
export async function keepAlive(
	rpc: Rpc,
	entry: Entry,
	label: string,
	run: Runner = stellar,
	log: Log = console.log,
): Promise<xdr.ScContractInstance | undefined> {
	let inspection = await inspect(rpc, entry, run)
	if (inspection.archived) {
		try {
			await restore(rpc, entry, run)
		} catch (cause) {
			if (!inspection.found) {
				throw new Error(
					`${label}: ${rpc.rpcUrl} has no entry for it, live or archived. Check the network and the contract id. (${String(cause)})`,
				)
			}
			throw cause
		}
		log(`${label} restored`)
		inspection = await inspect(rpc, entry, run)
		if (inspection.archived)
			throw new Error(`${label} is still archived after the restore`)
	}
	const until = await extend(rpc, entry, EXTEND_LEDGERS, run)
	log(`${label} live until ledger ${until}`)
	return inspection.instance
}

/**
 * Keeps every instance, the Wasm each one runs and every open timelock
 * change alive, reading the open ids from instance storage.
 */
export async function keepDeploymentAlive(
	rpc: Rpc,
	contracts: ReadonlyArray<readonly [string, string]>,
	run: Runner = stellar,
	log: Log = console.log,
): Promise<void> {
	const instances = new Map<string, xdr.ScContractInstance>()
	for (const [name, id] of contracts) {
		const instance = await keepAlive(rpc, { id }, `${name} instance`, run, log)
		if (instance !== undefined) instances.set(id, instance)
	}

	const wasmHashes = new Set<string>()
	for (const instance of instances.values()) {
		const wasmHash = wasmHashOf(instance)
		if (wasmHash !== undefined) wasmHashes.add(wasmHash)
	}
	for (const wasmHash of wasmHashes) {
		await keepAlive(rpc, { wasmHash }, `code ${wasmHash.slice(0, 8)}`, run, log)
	}

	for (const [name, id] of contracts) {
		const instance = instances.get(id)
		if (instance === undefined) continue
		for (const changeId of openChangeIds(instance)) {
			await keepAlive(
				rpc,
				{ id, keyXdr: pendingChangeKey(changeId).toXDR("base64") },
				`${name} pending change ${changeId}`,
				run,
				log,
			)
		}
	}
}

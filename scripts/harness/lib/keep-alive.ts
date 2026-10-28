import { type xdr } from "@stellar/stellar-sdk"

import { stellar, type Rpc } from "./cli.js"
import {
	EXTEND_LEDGERS,
	extend,
	inspect,
	restore,
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

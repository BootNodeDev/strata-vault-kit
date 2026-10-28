import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
	contractIds,
	networkOf,
	selectedEnvironment,
} from "../lib/environments.mjs"

import { type Rpc } from "./lib/cli.js"
import { REPO_ROOT } from "./lib/deployment.js"
import { keepDeploymentAlive } from "./lib/keep-alive.js"
import { latestLedger } from "./lib/ttl.js"

// Restores, when archived, and extends by 30 days each contract instance, the
// Wasm it runs and each pending timelock change, so an idle deployment stays
// callable. Extending needs no authority: any funded account pays.

interface DeploymentRecord {
	contracts: Record<string, string>
	asset?: { contract: string }
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
	await keepDeploymentAlive(rpc, contracts)
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})

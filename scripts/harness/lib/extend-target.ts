import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
	contractIds,
	networkOf,
	selectedEnvironment,
} from "../../lib/environments.mjs"

import { type Rpc } from "./cli.js"
import { REPO_ROOT } from "./deployment.js"
import { networkNamed } from "./network.js"

export interface ExtendTarget {
	network: string
	source: string
	rpc: Rpc
	contracts: Array<[string, string]>
}

interface DeploymentRecord {
	network?: string
	contracts: Record<string, string>
	asset?: { contract: string }
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
	const at = argv.indexOf(flag)
	if (at === -1) return undefined
	const value = argv[at + 1]
	if (value === undefined) throw new Error(`${flag} needs a value`)
	return value
}

function recordContracts(record: DeploymentRecord): Array<[string, string]> {
	const contracts: Array<[string, string]> = Object.entries(record.contracts)
	if (record.asset !== undefined)
		contracts.push(["asset", record.asset.contract])
	return contracts
}

export function resolveTarget(
	argv: readonly string[],
	env: Record<string, string | undefined>,
	readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): ExtendTarget {
	const config = flagValue(argv, "--config")
	const envFlag = flagValue(argv, "--env")
	const toml = () => readFile(join(REPO_ROOT, "environments.toml"))

	if (config === undefined) {
		const name = envFlag ?? selectedEnvironment(env)
		const { rpcUrl, networkPassphrase } = networkOf(toml(), name)
		return {
			network: name,
			source: "environments.toml",
			rpc: { rpcUrl, passphrase: networkPassphrase },
			contracts: contractIds(toml(), name).map(
				({ name: contract, id }) => [contract, id] as [string, string],
			),
		}
	}

	// npm runs workspace scripts from the workspace; resolve from where it was called.
	const path = resolve(env["INIT_CWD"] ?? process.cwd(), config)
	const record = JSON.parse(readFile(path)) as DeploymentRecord
	if (record.network !== "local" && record.network !== "testnet")
		throw new Error(`${config} has no network of local or testnet`)
	const contracts = recordContracts(record)
	if (contracts.length === 0) throw new Error(`${config} lists no contracts`)

	if (envFlag === undefined) {
		const { rpcUrl, passphrase } = networkNamed(record.network)
		return {
			network: record.network,
			source: `record ${config}`,
			rpc: { rpcUrl, passphrase },
			contracts,
		}
	}

	const { rpcUrl, networkPassphrase } = networkOf(toml(), envFlag)
	return {
		network: envFlag,
		source: `--env, overriding the record's ${record.network}`,
		rpc: { rpcUrl, passphrase: networkPassphrase },
		contracts,
	}
}

export function describeTarget(target: ExtendTarget): string {
	return `using network ${target.network} (${target.source}), RPC ${target.rpc.rpcUrl}`
}

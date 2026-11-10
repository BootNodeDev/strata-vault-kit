import {
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { ACCOUNT_NAMES, type AccountName, type Accounts } from "./accounts.js"
import { type NetworkName } from "./network.js"

export const CONTRACT_NAMES = [
	"compliance",
	"identity_verifier",
	"share_token",
	"nav_oracle",
	"async_vault",
	"sep40_feed",
] as const

export type ContractName = (typeof CONTRACT_NAMES)[number]

export interface Deployment {
	network: NetworkName
	deployedAt: string
	commit: string
	uncommittedChanges: boolean
	// The feed's own source commit: equal to `commit` for a set deployed
	// whole, but its own when `withFeed` adds a feed to an older set.
	feedCommit: string
	feedUncommittedChanges: boolean
	ledger: number
	asset: { code: string; issuer: string; contract: string }
	contracts: Record<ContractName, string>
	wasmHashes: Record<ContractName, string>
	accounts: Record<AccountName, { public: string }>
}

// Adds a feed to a set deployed before the feed existed.
export function withFeed(
	record: Deployment,
	feed: string,
	wasmHash: string,
	source: { commit: string; uncommittedChanges: boolean },
): Deployment {
	if (record.contracts.sep40_feed !== undefined) {
		throw new Error("the deployment already has a sep40_feed")
	}
	return {
		...record,
		contracts: { ...record.contracts, sep40_feed: feed },
		wasmHashes: { ...record.wasmHashes, sep40_feed: wasmHash },
		feedCommit: source.commit,
		feedUncommittedChanges: source.uncommittedChanges,
	}
}

export function publicKeysOf(accounts: Accounts): Deployment["accounts"] {
	return Object.fromEntries(
		ACCOUNT_NAMES.map((name) => [name, { public: accounts[name].publicKey() }]),
	) as Deployment["accounts"]
}

export const PACKAGE_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
)
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..")

export function deploymentFile(
	network: NetworkName,
	dir = PACKAGE_ROOT,
): string {
	return join(dir, `deployed.${network}.json`)
}

const README_START = "<!-- deployed-addresses:start -->"
const README_END = "<!-- deployed-addresses:end -->"

// The README lists the IDs as text (grant measure); the deploy keeps the list
// in sync with environments.toml rather than relying on a hand edit.
export function renderAddressesTable(record: Deployment): string {
	const rows: Array<[string, string]> = [
		["async_vault", record.contracts.async_vault],
		["nav_oracle", record.contracts.nav_oracle],
		["share_token", record.contracts.share_token],
		["identity_verifier", record.contracts.identity_verifier],
		["compliance", record.contracts.compliance],
		["sep40_feed", record.contracts.sep40_feed],
		["asset", record.asset.contract],
	]
	return [
		"| Contract | Address |",
		"| --- | --- |",
		...rows.map(([name, id]) => `| \`${name}\` | \`${id}\` |`),
	].join("\n")
}

export function replaceAddressesBlock(content: string, table: string): string {
	const start = content.indexOf(README_START)
	const end = content.indexOf(README_END)
	if (start === -1 || end === -1 || end < start) {
		throw new Error("README.md is missing the deployed-addresses markers")
	}
	return (
		content.slice(0, start + README_START.length) +
		`\n${table}\n` +
		content.slice(end)
	)
}

function syncReadmeAddresses(record: Deployment): void {
	const readmePath = join(REPO_ROOT, "README.md")
	const content = readFileSync(readmePath, "utf8")
	writeFileSync(
		readmePath,
		replaceAddressesBlock(content, renderAddressesTable(record)),
	)
}

// Pure, so a unit test can check the rewrite without touching the file system.
export function replaceStagingContracts(
	content: string,
	record: Deployment,
): string {
	const stagingContractsBlock = [
		`[staging.contracts]`,
		`async_vault = { id = "${record.contracts.async_vault}" }`,
		`nav_oracle = { id = "${record.contracts.nav_oracle}" }`,
		`share_token = { id = "${record.contracts.share_token}" }`,
		`identity_verifier = { id = "${record.contracts.identity_verifier}" }`,
		`compliance = { id = "${record.contracts.compliance}" }`,
		`sep40_feed = { id = "${record.contracts.sep40_feed}" }`,
		`asset = { id = "${record.asset.contract}" }`,
	].join("\n")

	const regex =
		/\[staging\.contracts\](?:\r?\n[a-z0-9_]+ = \{ id = "[^"]*" \})*/
	if (!regex.test(content)) {
		throw new Error(
			"Could not find [staging.contracts] section in environments.toml",
		)
	}
	return content.replace(regex, stagingContractsBlock)
}

export function syncEnvironmentsStaging(record: Deployment): void {
	if (record.network !== "testnet") return
	const envPath = join(REPO_ROOT, "environments.toml")
	const content = readFileSync(envPath, "utf8")
	writeFileSync(envPath, replaceStagingContracts(content, record))
}

function recordedTime(file: string): unknown {
	try {
		const record = JSON.parse(readFileSync(file, "utf8")) as {
			deployedAt?: unknown
		} | null
		return record?.deployedAt
	} catch {
		return undefined
	}
}

function deployedAt(file: string): Date {
	const recorded = recordedTime(file)
	return typeof recorded === "string" && !Number.isNaN(Date.parse(recorded))
		? new Date(recorded)
		: statSync(file).mtime
}

function keepPrevious(file: string): string | undefined {
	if (!existsSync(file)) return undefined
	const stamp = deployedAt(file).toISOString().replaceAll(/[:.]/g, "-")
	const base = file.replace(/\.json$/, `.${stamp}`)
	let kept = `${base}.json`
	for (let n = 1; existsSync(kept); n += 1) kept = `${base}-${n}.json`
	renameSync(file, kept)
	return kept
}

// Returns where the previous record was kept, if there was one.
export function saveDeployment(
	record: Deployment,
	dir = PACKAGE_ROOT,
): string | undefined {
	const file = deploymentFile(record.network, dir)
	const kept = keepPrevious(file)
	writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
	if (record.network === "testnet") {
		syncEnvironmentsStaging(record)
		syncReadmeAddresses(record)
	}
	return kept
}

export function loadDeployment(network: NetworkName): Deployment {
	return JSON.parse(readFileSync(deploymentFile(network), "utf8")) as Deployment
}

export interface IncompleteDeployment {
	network: NetworkName
	startedAt: string
	complete: false
	asset: Deployment["asset"]
	contracts: Partial<Record<ContractName, string>>
}

export function incompleteFile(
	network: NetworkName,
	dir = PACKAGE_ROOT,
): string {
	return join(dir, `deployed.${network}.incomplete.json`)
}

export function writeIncomplete(
	progress: IncompleteDeployment,
	dir = PACKAGE_ROOT,
): void {
	writeFileSync(
		incompleteFile(progress.network, dir),
		`${JSON.stringify(progress, null, 2)}\n`,
	)
}

export function clearIncomplete(
	network: NetworkName,
	dir = PACKAGE_ROOT,
): void {
	const file = incompleteFile(network, dir)
	if (existsSync(file)) rmSync(file)
}

export function refuseIncomplete(
	network: NetworkName,
	dir = PACKAGE_ROOT,
): void {
	const file = incompleteFile(network, dir)
	if (!existsSync(file)) return
	throw new Error(
		`a deploy to ${network} stopped before it finished. The contracts it created are listed in ${relative(REPO_ROOT, file)}, and nothing else uses them. Move or delete that file, then deploy again for a new set.`,
	)
}

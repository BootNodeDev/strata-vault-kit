import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { type AccountName } from "./accounts.js"
import { type NetworkName } from "./network.js"

export const CONTRACT_NAMES = [
	"compliance",
	"identity_verifier",
	"share_token",
	"nav_oracle",
	"async_vault",
] as const

export type ContractName = (typeof CONTRACT_NAMES)[number]

export interface Deployment {
	network: NetworkName
	deployedAt: string
	ledger: number
	asset: { code: string; issuer: string; contract: string }
	contracts: Record<ContractName, string>
	accounts: Record<AccountName, { public: string; secret: string }>
}

export const PACKAGE_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
)
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..")

export function deploymentFile(network: NetworkName): string {
	return join(PACKAGE_ROOT, `deployed.${network}.json`)
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

export function syncEnvironmentsStaging(record: Deployment): void {
	if (record.network !== "testnet") return
	const envPath = join(REPO_ROOT, "environments.toml")
	let content = readFileSync(envPath, "utf8")

	const stagingContractsBlock = [
		`[staging.contracts]`,
		`async_vault = { id = "${record.contracts.async_vault}" }`,
		`nav_oracle = { id = "${record.contracts.nav_oracle}" }`,
		`share_token = { id = "${record.contracts.share_token}" }`,
		`identity_verifier = { id = "${record.contracts.identity_verifier}" }`,
		`compliance = { id = "${record.contracts.compliance}" }`,
		`asset = { id = "${record.asset.contract}" }`,
	].join("\n")

	const regex = /\[staging\.contracts\](?:\r?\n[a-z_]+ = \{ id = "[^"]*" \})*/
	if (!regex.test(content)) {
		throw new Error(
			"Could not find [staging.contracts] section in environments.toml",
		)
	}
	content = content.replace(regex, stagingContractsBlock)
	writeFileSync(envPath, content)
}

export function saveDeployment(record: Deployment): void {
	writeFileSync(
		deploymentFile(record.network),
		`${JSON.stringify(record, null, 2)}\n`,
	)
	if (record.network === "testnet") {
		syncEnvironmentsStaging(record)
		syncReadmeAddresses(record)
	}
}

export function loadDeployment(network: NetworkName): Deployment {
	return JSON.parse(readFileSync(deploymentFile(network), "utf8")) as Deployment
}

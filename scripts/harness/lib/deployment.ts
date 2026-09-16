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

export function saveDeployment(record: Deployment): void {
	writeFileSync(
		deploymentFile(record.network),
		`${JSON.stringify(record, null, 2)}\n`,
	)
}

export function loadDeployment(network: NetworkName): Deployment {
	return JSON.parse(readFileSync(deploymentFile(network), "utf8")) as Deployment
}

import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { Asset, Keypair, rpc } from "@stellar/stellar-sdk"
import { basicNodeSigner } from "@stellar/stellar-sdk/contract"

import type * as AsyncVaultModule from "../../app-lib/clients/async_vault/dist/index.js"
import type * as ComplianceModule from "../../app-lib/clients/compliance/dist/index.js"
import type * as IdentityVerifierModule from "../../app-lib/clients/identity_verifier/dist/index.js"
import type * as NavOracleModule from "../../app-lib/clients/nav_oracle/dist/index.js"
import type * as ShareTokenModule from "../../app-lib/clients/share_token/dist/index.js"

import { freshAccounts, fund, type Accounts } from "./lib/accounts.js"
import {
	deployAssetContract,
	deployContract,
	generateClient,
} from "./lib/cli.js"
import {
	CONTRACT_NAMES,
	REPO_ROOT,
	saveDeployment,
	type ContractName,
	type Deployment,
} from "./lib/deployment.js"
import { network, type Network } from "./lib/network.js"

const RELEASE_DIR = join(REPO_ROOT, "target", "wasm32v1-none", "release")
export const SHORT_WIND_DOWN_DIR = join(
	REPO_ROOT,
	"target",
	"short-wind-down",
	"wasm32v1-none",
	"release",
)

export const wasmOf = (name: ContractName, dir = RELEASE_DIR): string =>
	join(dir, `${name}.wasm`)

const clientDir = (name: ContractName): string =>
	join(REPO_ROOT, "app-lib", "clients", name)

const clientEntry = (name: ContractName): string =>
	pathToFileURL(join(clientDir(name), "dist", "index.js")).href

function requireWasm(vaultWasm: string = wasmOf("async_vault")): void {
	const missing = CONTRACT_NAMES.filter(
		(name) => !existsSync(name === "async_vault" ? vaultWasm : wasmOf(name)),
	)
	if (missing.length > 0) {
		throw new Error(
			`no wasm for ${missing.join(", ")}; run \`stellar contract build\` first`,
		)
	}
}

function clientOptions(net: Network, contractId: string, signer: Keypair) {
	return {
		contractId,
		rpcUrl: net.rpcUrl,
		networkPassphrase: net.passphrase,
		allowHttp: net.name === "local",
		publicKey: signer.publicKey(),
		...basicNodeSigner(signer, net.passphrase),
	}
}

async function deployContracts(
	net: Network,
	accounts: Accounts,
	assetContract: string,
	wasms: Record<ContractName, string>,
): Promise<Record<ContractName, string>> {
	const pk = (name: keyof Accounts): string => accounts[name].publicKey()
	const deployer = accounts.deployer
	const governance = pk("governance")

	const compliance = await deployContract(net, wasms.compliance, deployer, {
		admin: governance,
	})
	console.log("compliance", compliance)

	const identityVerifier = await deployContract(
		net,
		wasms.identity_verifier,
		deployer,
		{ admin: pk("compliance") },
	)
	console.log("identity_verifier", identityVerifier)

	const shareToken = await deployContract(net, wasms.share_token, deployer, {
		name: "Strata Vault USDC",
		symbol: "bvUSDC",
		admin: governance,
		compliance_authority: pk("compliance"),
		compliance,
		identity_verifier: identityVerifier,
	})
	console.log("share_token", shareToken)

	const navOracle = await deployContract(net, wasms.nav_oracle, deployer, {
		admin: governance,
		attester: pk("attester"),
		guardian: pk("guardian"),
		config: JSON.stringify(net.oracle),
	})
	console.log("nav_oracle", navOracle)

	const asyncVault = await deployContract(net, wasms.async_vault, deployer, {
		asset: assetContract,
		share_token: shareToken,
		oracle: navOracle,
		roles: JSON.stringify({
			governance,
			manager: pk("manager"),
			treasury: pk("treasury"),
			guardian: pk("guardian"),
			compliance: pk("compliance"),
			attester: pk("attester"),
		}),
	})
	console.log("async_vault", asyncVault)

	return {
		compliance,
		identity_verifier: identityVerifier,
		share_token: shareToken,
		nav_oracle: navOracle,
		async_vault: asyncVault,
	}
}

// The vault mints and burns, so it needs the token's manager role; it returns
// escrowed shares through the checked transfer, so it must itself be
// allowed; and compliance only runs its hooks for a bound token, so the
// share token must be bound to it.
async function grantAndVerify(
	net: Network,
	accounts: Accounts,
	contracts: Record<ContractName, string>,
): Promise<void> {
	const governance = accounts.governance
	const caller = governance.publicKey()
	const vault = contracts.async_vault

	const { Client: ShareToken } = (await import(
		clientEntry("share_token")
	)) as typeof ShareTokenModule
	const token = new ShareToken(
		clientOptions(net, contracts.share_token, governance),
	)
	await (
		await token.grant_role({ account: vault, role: "manager", caller })
	).signAndSend()
	const role = (await token.has_role({ account: vault, role: "manager" }))
		.result
	// The binding types a missing role as undefined; the SDK returns null.
	if (typeof role !== "number")
		throw new Error("the vault did not receive the share token's manager role")
	console.log("vault holds share_token manager role")

	// Grants are instant only during setup, so the token's setup closes after them.
	await (await token.bind_vault({ vault, caller })).signAndSend()
	await (await token.finish_setup({ caller })).signAndSend()
	if ((await token.setup_open()).result)
		throw new Error("the share token's setup did not finish")
	console.log("share_token bound to the vault, setup finished")

	const { Client: IdentityVerifier } = (await import(
		clientEntry("identity_verifier")
	)) as typeof IdentityVerifierModule
	const verifier = new IdentityVerifier(
		clientOptions(net, contracts.identity_verifier, accounts.compliance),
	)
	await (
		await verifier.allow({
			account: vault,
			allowed: true,
			caller: accounts.compliance.publicKey(),
		})
	).signAndSend()
	const allowed = (await verifier.is_allowed({ account: vault })).result
	if (allowed !== true)
		throw new Error("the vault was not allowlisted on the identity verifier")
	console.log("vault is allowlisted")

	const { Client: Compliance } = (await import(
		clientEntry("compliance")
	)) as typeof ComplianceModule
	const compliance = new Compliance(
		clientOptions(net, contracts.compliance, governance),
	)
	await (
		await compliance.bind_token({
			token: contracts.share_token,
			operator: caller,
		})
	).signAndSend()
	const linked = (await compliance.linked_tokens()).result
	if (!linked.includes(contracts.share_token))
		throw new Error("the share token was not bound to the compliance contract")
	console.log("share_token bound to compliance")

	const { Client: NavOracle } = (await import(
		clientEntry("nav_oracle")
	)) as typeof NavOracleModule
	const feed = new NavOracle(
		clientOptions(net, contracts.nav_oracle, governance),
	)
	await (await feed.bind_vault({ vault, caller })).signAndSend()
	await (await feed.finish_setup({ caller })).signAndSend()
	if ((await feed.setup_open()).result)
		throw new Error("the oracle's setup did not finish")
	console.log("nav_oracle bound to the vault, setup finished")
}

// The custodian is set while setup is open; afterwards it changes only through
// the timelock. finish_setup refuses unless every wiring step above landed.
async function finishVaultSetup(
	net: Network,
	accounts: Accounts,
	contracts: Record<ContractName, string>,
): Promise<void> {
	const governance = accounts.governance
	const caller = governance.publicKey()
	const { Client: AsyncVault } = (await import(
		clientEntry("async_vault")
	)) as typeof AsyncVaultModule
	const vault = new AsyncVault(
		clientOptions(net, contracts.async_vault, governance),
	)
	await (
		await vault.set_custodian({
			custodian: accounts.custodian.publicKey(),
			caller,
		})
	).signAndSend()
	await (await vault.finish_setup({ caller })).signAndSend()
	if ((await vault.setup_open()).result)
		throw new Error("the vault's setup did not finish")
	console.log("vault setup finished")

	const health = (await vault.health()).result
	console.log("health", JSON.stringify(health))
	const wiring = [
		"token_bound",
		"oracle_bound",
		"sole_token_manager",
		"allowlisted",
		"vault_unfrozen",
		"compliance_bound",
	] as const
	const broken = wiring.filter((flag) => !health[flag])
	if (health.setup_open || broken.length > 0)
		throw new Error(`the vault is not wired: ${broken.join(", ")}`)
}

async function freshSet(
	net: Network,
	wasms: Record<ContractName, string>,
): Promise<Deployment> {
	const server = new rpc.Server(net.rpcUrl, { allowHttp: net.name === "local" })
	const accounts = freshAccounts()
	await fund(net, server, Object.values(accounts))
	console.log(`funded ${Object.keys(accounts).length} accounts`)

	const asset = new Asset("USDC", accounts.issuer.publicKey())
	const assetContract = await deployAssetContract(net, asset, accounts.issuer)
	console.log("asset contract", assetContract)

	const contracts = await deployContracts(net, accounts, assetContract, wasms)

	return {
		network: net.name,
		deployedAt: new Date().toISOString(),
		ledger: (await server.getLatestLedger()).sequence,
		asset: {
			code: asset.getCode(),
			issuer: asset.getIssuer() ?? accounts.issuer.publicKey(),
			contract: assetContract,
		},
		contracts,
		accounts: Object.fromEntries(
			Object.entries(accounts).map(([name, key]) => [
				name,
				{ public: key.publicKey(), secret: key.secret() },
			]),
		) as Deployment["accounts"],
	}
}

const keysOf = (record: Deployment): Accounts =>
	Object.fromEntries(
		Object.entries(record.accounts).map(([name, key]) => [
			name,
			Keypair.fromSecret(key.secret),
		]),
	) as Accounts

// A full, wired vault set built from a different vault Wasm. It reuses the
// clients the main deploy generated, and nothing is written to disk.
export async function deployThrowaway(
	net: Network,
	vaultWasm: string,
): Promise<Deployment> {
	requireWasm(vaultWasm)
	const wasms = Object.fromEntries(
		CONTRACT_NAMES.map((name) => [name, wasmOf(name)]),
	) as Record<ContractName, string>
	wasms.async_vault = vaultWasm
	const record = await freshSet(net, wasms)
	const accounts = keysOf(record)
	await grantAndVerify(net, accounts, record.contracts)
	await finishVaultSetup(net, accounts, record.contracts)
	return record
}

async function main(): Promise<void> {
	requireWasm()
	const net = network()
	console.log(`deploying to ${net.name} (${net.rpcUrl})`)
	const wasms = Object.fromEntries(
		CONTRACT_NAMES.map((name) => [name, wasmOf(name)]),
	) as Record<ContractName, string>
	const record = await freshSet(net, wasms)

	for (const name of CONTRACT_NAMES) {
		await generateClient(wasmOf(name), clientDir(name))
	}
	console.log("clients generated")

	const accounts = keysOf(record)
	await grantAndVerify(net, accounts, record.contracts)
	await finishVaultSetup(net, accounts, record.contracts)

	saveDeployment(record)
	console.log(`wrote deployed.${net.name}.json`)
	if (net.name === "testnet") {
		console.log("updated environments.toml [staging.contracts]")
	}
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	})
}

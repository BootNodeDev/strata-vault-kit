import { existsSync } from "node:fs"
import { basename, join, relative } from "node:path"
import { pathToFileURL } from "node:url"

import { Asset, Keypair, rpc } from "@stellar/stellar-sdk"
import { basicNodeSigner } from "@stellar/stellar-sdk/contract"

import type * as AsyncVaultModule from "../../app-lib/clients/async_vault/dist/index.js"
import type * as ComplianceModule from "../../app-lib/clients/compliance/dist/index.js"
import type * as IdentityVerifierModule from "../../app-lib/clients/identity_verifier/dist/index.js"
import type * as NavOracleModule from "../../app-lib/clients/nav_oracle/dist/index.js"
import type * as ShareTokenModule from "../../app-lib/clients/share_token/dist/index.js"

import { ACCOUNT_NAMES, fund, pay, type Accounts } from "./lib/accounts.js"
import { returnToIssuer } from "./lib/balances.js"
import {
	deployContract,
	ensureAssetContract,
	generateClient,
	rootSdkVersion,
} from "./lib/cli.js"
import {
	clearIncomplete,
	CONTRACT_NAMES,
	publicKeysOf,
	refuseIncomplete,
	REPO_ROOT,
	saveDeployment,
	writeIncomplete,
	type ContractName,
	type Deployment,
	type IncompleteDeployment,
} from "./lib/deployment.js"
import { ensureKeys } from "./lib/keys.js"
import { network, type Network } from "./lib/network.js"
import { readProvenance, type Provenance } from "./lib/provenance.js"
import { withAccountRetry } from "./lib/rpc.js"

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

function clientOptions(
	net: Network,
	contractId: string,
	signer: Keypair,
	server: rpc.Server,
) {
	return {
		contractId,
		rpcUrl: net.rpcUrl,
		networkPassphrase: net.passphrase,
		allowHttp: net.name === "local",
		publicKey: signer.publicKey(),
		server,
		...basicNodeSigner(signer, net.passphrase),
	}
}

async function deployContracts(
	net: Network,
	accounts: Accounts,
	assetContract: string,
	wasms: Record<ContractName, string>,
	onDeployed?: (name: ContractName, id: string) => void,
): Promise<Record<ContractName, string>> {
	const pk = (name: keyof Accounts): string => accounts[name].publicKey()
	const deployer = accounts.deployer
	const governance = pk("governance")

	const compliance = await deployContract(net, wasms.compliance, deployer, {
		admin: governance,
	})
	console.log("compliance", compliance)
	onDeployed?.("compliance", compliance)

	const identityVerifier = await deployContract(
		net,
		wasms.identity_verifier,
		deployer,
		{ admin: pk("compliance") },
	)
	console.log("identity_verifier", identityVerifier)
	onDeployed?.("identity_verifier", identityVerifier)

	const shareToken = await deployContract(net, wasms.share_token, deployer, {
		name: "Strata Vault USDC",
		symbol: "bvUSDC",
		admin: governance,
		compliance_authority: pk("compliance"),
		compliance,
		identity_verifier: identityVerifier,
	})
	console.log("share_token", shareToken)
	onDeployed?.("share_token", shareToken)

	const navOracle = await deployContract(net, wasms.nav_oracle, deployer, {
		admin: governance,
		attester: pk("attester"),
		guardian: pk("guardian"),
		config: JSON.stringify(net.oracle),
	})
	console.log("nav_oracle", navOracle)
	onDeployed?.("nav_oracle", navOracle)

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
	onDeployed?.("async_vault", asyncVault)

	return {
		compliance,
		identity_verifier: identityVerifier,
		share_token: shareToken,
		nav_oracle: navOracle,
		async_vault: asyncVault,
	}
}

// The vault mints and burns, so it needs the token's manager role; it mints a
// delisted holder's converted deposit into its own escrow, so it must itself
// be allowed; and compliance only runs its hooks for a bound token, so the
// share token must be bound to it.
async function grantAndVerify(
	net: Network,
	accounts: Accounts,
	contracts: Record<ContractName, string>,
	server: rpc.Server,
): Promise<void> {
	const governance = accounts.governance
	const caller = governance.publicKey()
	const vault = contracts.async_vault

	const { Client: ShareToken } = (await import(
		clientEntry("share_token")
	)) as typeof ShareTokenModule
	const token = new ShareToken(
		clientOptions(net, contracts.share_token, governance, server),
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
	await (await token.bind_vault({ vault })).signAndSend()
	await (await token.finish_setup()).signAndSend()
	if ((await token.setup_open()).result)
		throw new Error("the share token's setup did not finish")
	console.log("share_token bound to the vault, setup finished")

	const { Client: IdentityVerifier } = (await import(
		clientEntry("identity_verifier")
	)) as typeof IdentityVerifierModule
	const verifier = new IdentityVerifier(
		clientOptions(
			net,
			contracts.identity_verifier,
			accounts.compliance,
			server,
		),
	)
	await (
		await verifier.allow({
			account: vault,
			allowed: true,
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
		clientOptions(net, contracts.compliance, governance, server),
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

	// Binding the token is instant only during setup, so the compliance
	// contract's setup closes after it.
	await (await compliance.bind_vault({ vault })).signAndSend()
	await (await compliance.finish_setup()).signAndSend()
	if ((await compliance.setup_open()).result)
		throw new Error("the compliance contract's setup did not finish")
	console.log("compliance bound to the vault, setup finished")

	const { Client: NavOracle } = (await import(
		clientEntry("nav_oracle")
	)) as typeof NavOracleModule
	const feed = new NavOracle(
		clientOptions(net, contracts.nav_oracle, governance, server),
	)
	await (await feed.bind_vault({ vault })).signAndSend()
	await (await feed.finish_setup()).signAndSend()
	if ((await feed.setup_open()).result)
		throw new Error("the oracle's setup did not finish")
	console.log("nav_oracle bound to the vault, setup finished")
}

// The custodian is set while setup is open; afterwards it changes only through
// the timelock. finish_setup refuses until the custodian and every wiring step
// above are in place.
async function finishVaultSetup(
	net: Network,
	accounts: Accounts,
	contracts: Record<ContractName, string>,
	server: rpc.Server,
): Promise<void> {
	const governance = accounts.governance
	const { Client: AsyncVault } = (await import(
		clientEntry("async_vault")
	)) as typeof AsyncVaultModule
	const vault = new AsyncVault(
		clientOptions(net, contracts.async_vault, governance, server),
	)
	await (
		await vault.set_custodian({
			custodian: accounts.custodian.publicKey(),
		})
	).signAndSend()
	const noticeSecs = BigInt(net.vault.notice_secs)
	await (await vault.set_notice({ secs: noticeSecs })).signAndSend()
	const notice = (await vault.notice()).result
	if (notice !== noticeSecs)
		throw new Error(`vault notice is ${notice}, expected ${noticeSecs}`)
	console.log(`vault notice set to ${noticeSecs} seconds`)
	await (await vault.finish_setup()).signAndSend()
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
		"decimals_match",
		"addresses_distinct",
		"custodian_set",
		"feed_answers",
	] as const
	const broken = wiring.filter((flag) => !health[flag])
	if (health.setup_open || broken.length > 0)
		throw new Error(`the vault is not wired: ${broken.join(", ")}`)
}

async function freshSet(
	net: Network,
	wasms: Record<ContractName, string>,
	provenance: Provenance,
	accounts: Accounts,
	server: rpc.Server,
	onProgress?: (progress: IncompleteDeployment) => void,
): Promise<Deployment> {
	// fund() reads "not found" as "not yet created"; it needs the plain server.
	const fundingServer = new rpc.Server(net.rpcUrl, {
		allowHttp: net.name === "local",
	})
	const keys = Object.values(accounts)
	const funded = await fund(net, fundingServer, keys)
	console.log(
		`funded ${funded} accounts; ${keys.length - funded} already existed`,
	)

	const asset = new Asset("USDC", accounts.issuer.publicKey())
	const assetContract = await ensureAssetContract(
		net,
		server,
		asset,
		accounts.issuer,
	)
	console.log("asset contract", assetContract)

	const issuer = asset.getIssuer() ?? accounts.issuer.publicKey()
	const returned = await returnToIssuer(server, keys, asset, (from, amount) =>
		pay(net, server, from, issuer, asset, amount),
	)
	console.log(
		`returned the deposit asset of ${returned} accounts to its issuer`,
	)

	const assetInfo = { code: asset.getCode(), issuer, contract: assetContract }
	const startedAt = new Date().toISOString()
	const progress: Partial<Record<ContractName, string>> = {}
	const onDeployed = onProgress
		? (name: ContractName, id: string): void => {
				progress[name] = id
				onProgress({
					network: net.name,
					startedAt,
					complete: false,
					asset: assetInfo,
					contracts: { ...progress },
				})
			}
		: undefined
	const contracts = await deployContracts(
		net,
		accounts,
		assetContract,
		wasms,
		onDeployed,
	)

	return {
		network: net.name,
		deployedAt: new Date().toISOString(),
		...provenance,
		ledger: (await server.getLatestLedger()).sequence,
		asset: assetInfo,
		contracts,
		accounts: publicKeysOf(accounts),
	}
}

// Random accounts, so a throwaway set leaves the kept keys and their funds alone.
const throwawayAccounts = (): Accounts =>
	Object.fromEntries(
		ACCOUNT_NAMES.map((name) => [name, Keypair.random()]),
	) as Accounts

// A full, wired vault set built from a different vault Wasm. It reuses the
// clients the main deploy generated, and nothing is written to disk.
export async function deployThrowaway(
	net: Network,
	vaultWasm: string,
): Promise<{ deployment: Deployment; keys: Accounts }> {
	requireWasm(vaultWasm)
	const wasms = Object.fromEntries(
		CONTRACT_NAMES.map((name) => [name, wasmOf(name)]),
	) as Record<ContractName, string>
	wasms.async_vault = vaultWasm
	const provenance = readProvenance(REPO_ROOT, wasms)
	const keys = throwawayAccounts()
	const server = withAccountRetry(
		new rpc.Server(net.rpcUrl, { allowHttp: net.name === "local" }),
	)
	const deployment = await freshSet(net, wasms, provenance, keys, server)
	await grantAndVerify(net, keys, deployment.contracts, server)
	await finishVaultSetup(net, keys, deployment.contracts, server)
	return { deployment, keys }
}

async function main(): Promise<void> {
	requireWasm()
	const net = network()
	refuseIncomplete(net.name)
	console.log(`deploying to ${net.name} (${net.rpcUrl})`)
	const wasms = Object.fromEntries(
		CONTRACT_NAMES.map((name) => [name, wasmOf(name)]),
	) as Record<ContractName, string>
	const provenance = readProvenance(REPO_ROOT, wasms)
	const sdkVersion = rootSdkVersion()
	const { file, accounts, created } = ensureKeys(net.name, REPO_ROOT)
	console.log(
		`account keys in ${relative(REPO_ROOT, file)} (${created.length} new)`,
	)
	const server = withAccountRetry(
		new rpc.Server(net.rpcUrl, { allowHttp: net.name === "local" }),
	)
	const record = await freshSet(
		net,
		wasms,
		provenance,
		accounts,
		server,
		(progress) => writeIncomplete(progress),
	)
	console.log(
		`commit ${record.commit}${record.uncommittedChanges ? " with uncommitted changes" : ""}`,
	)

	for (const name of CONTRACT_NAMES) {
		await generateClient(wasmOf(name), clientDir(name), sdkVersion)
	}
	console.log("clients generated")

	await grantAndVerify(net, accounts, record.contracts, server)
	await finishVaultSetup(net, accounts, record.contracts, server)

	const kept = saveDeployment(record)
	clearIncomplete(net.name)
	if (kept !== undefined)
		console.log(`kept the previous record as ${basename(kept)}`)
	console.log(`wrote deployed.${net.name}.json`)
	if (net.name === "testnet") {
		console.log(
			"updated environments.toml [staging.contracts] and the README addresses: commit both, or the app keeps building against the previous contracts",
		)
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

import { existsSync } from "node:fs"
import { basename, join, relative } from "node:path"
import { pathToFileURL } from "node:url"

import { Asset, Keypair, rpc } from "@stellar/stellar-sdk"
import { basicNodeSigner } from "@stellar/stellar-sdk/contract"

import type * as AsyncVaultModule from "../../app-lib/clients/async_vault/dist/index.js"
import type * as ClaimIssuerModule from "../../app-lib/clients/claim_issuer/dist/index.js"
import type * as ClaimTopicsModule from "../../app-lib/clients/claim_topics/dist/index.js"
import type * as ComplianceModule from "../../app-lib/clients/compliance/dist/index.js"
import type * as IdentityRegistryModule from "../../app-lib/clients/identity_registry/dist/index.js"
import type * as IdentityVerifierModule from "../../app-lib/clients/identity_verifier/dist/index.js"
import type * as NavOracleModule from "../../app-lib/clients/nav_oracle/dist/index.js"
import type * as Sep40FeedModule from "../../app-lib/clients/sep40_feed/dist/index.js"
import type * as ShareTokenModule from "../../app-lib/clients/share_token/dist/index.js"

import { ACCOUNT_NAMES, fund, pay, type Accounts } from "./lib/accounts.js"
import { returnToIssuer } from "./lib/balances.js"
import { KYC_TOPIC } from "./lib/claims.js"
import {
	deployContract,
	ensureAssetContract,
	generateClient,
	rootSdkVersion,
	uploadWasm,
	wasmGenerator,
	type ConstructorArgs,
} from "./lib/cli.js"
import {
	clearIncomplete,
	publicKeysOf,
	refuseIncomplete,
	REPO_ROOT,
	saveDeployment,
	WASM_NAMES,
	writeIncomplete,
	type ContractName,
	type Deployment,
	type ExampleName,
	type IncompleteDeployment,
	type WasmName,
} from "./lib/deployment.js"
import { ensureKeys } from "./lib/keys.js"
import { network, type Network } from "./lib/network.js"
import { readProvenance, type Provenance } from "./lib/provenance.js"
import { withAccountRetry } from "./lib/rpc.js"
import { stellarAsset } from "./lib/sep40.js"

const RELEASE_DIR = join(REPO_ROOT, "target", "wasm32v1-none", "release")
export const SHORT_WIND_DOWN_DIR = join(
	REPO_ROOT,
	"target",
	"short-wind-down",
	"wasm32v1-none",
	"release",
)

export const wasmOf = (
	name: WasmName | ExampleName,
	dir = RELEASE_DIR,
): string => join(dir, `${name}.wasm`)

const clientDir = (name: WasmName): string =>
	join(REPO_ROOT, "app-lib", "clients", name)

const clientEntry = (name: WasmName): string =>
	pathToFileURL(join(clientDir(name), "dist", "index.js")).href

function requireWasm(vaultWasm: string = wasmOf("async_vault")): void {
	const missing = WASM_NAMES.filter(
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
	wasms: Record<WasmName, string>,
	onDeployed?: (name: ContractName, id: string) => void,
): Promise<Record<ContractName, string>> {
	const pk = (name: keyof Accounts): string => accounts[name].publicKey()
	const deployer = accounts.deployer
	const governance = pk("governance")
	const deploy = async (
		name: ContractName,
		args: ConstructorArgs,
	): Promise<string> => {
		const id = await deployContract(net, wasms[name], deployer, args)
		console.log(name, id)
		onDeployed?.(name, id)
		return id
	}

	const compliance = await deploy("compliance", { admin: governance })

	// Uploaded only: the registry and the topics contract take these hashes.
	const identityWasm = await uploadWasm(net, wasms.investor_identity, deployer)
	console.log("investor_identity wasm", identityWasm)
	const issuerWasm = await uploadWasm(net, wasms.claim_issuer, deployer)
	console.log("claim_issuer wasm", issuerWasm)

	const claimTopics = await deploy("claim_topics", {
		admin: governance,
		issuer_wasm: issuerWasm,
	})
	const identityRegistry = await deploy("identity_registry", {
		admin: governance,
		compliance: pk("compliance"),
		identity_wasm: identityWasm,
	})
	const identityVerifier = await deploy("identity_verifier", {
		admin: governance,
		registry: identityRegistry,
		topics: claimTopics,
	})
	const claimIssuer = await deploy("claim_issuer", {
		owner: pk("kyc-provider"),
	})

	const shareToken = await deploy("share_token", {
		name: "Strata Vault USDC",
		symbol: "bvUSDC",
		admin: governance,
		compliance_authority: pk("compliance"),
		compliance,
		identity_verifier: identityVerifier,
	})

	const navOracle = await deploy("nav_oracle", {
		admin: governance,
		attester: pk("attester"),
		guardian: pk("guardian"),
		config: JSON.stringify(net.oracle),
	})

	const asyncVault = await deploy("async_vault", {
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

	const sep40Feed = await deploy("sep40_feed", { vault: asyncVault })

	return {
		compliance,
		claim_topics: claimTopics,
		identity_registry: identityRegistry,
		identity_verifier: identityVerifier,
		claim_issuer: claimIssuer,
		share_token: shareToken,
		nav_oracle: navOracle,
		async_vault: asyncVault,
		sep40_feed: sep40Feed,
	}
}

interface Setup {
	bind_vault(args: {
		vault: string
	}): Promise<{ signAndSend(): Promise<unknown> }>
	finish_setup(): Promise<{ signAndSend(): Promise<unknown> }>
	setup_open(): Promise<{ result: boolean }>
}

async function closeSetup(name: string, client: Setup, vault: string) {
	await (await client.bind_vault({ vault })).signAndSend()
	await (await client.finish_setup()).signAndSend()
	if ((await client.setup_open()).result)
		throw new Error(`the ${name} setup did not finish`)
	console.log(`${name} bound to the vault, setup finished`)
}

// The vault mints a delisted holder's converted deposit into its own escrow,
// so the verifier must let it in: binding the vault makes it a protocol
// address. The vault's setup checks that the verifier, the registry and the
// topics contract are governance's, bound to it and closed.
async function wireIdentity(
	net: Network,
	accounts: Accounts,
	contracts: Record<ContractName, string>,
	server: rpc.Server,
): Promise<void> {
	const governance = accounts.governance
	const operator = governance.publicKey()
	const vault = contracts.async_vault
	const kyc = accounts["kyc-provider"]

	const { Client: ClaimTopics } = (await import(
		clientEntry("claim_topics")
	)) as typeof ClaimTopicsModule
	const topics = new ClaimTopics(
		clientOptions(net, contracts.claim_topics, governance, server),
	)
	await (
		await topics.add_claim_topic({ claim_topic: KYC_TOPIC, operator })
	).signAndSend()
	await (
		await topics.add_trusted_issuer({
			trusted_issuer: contracts.claim_issuer,
			claim_topics: [KYC_TOPIC],
			operator,
		})
	).signAndSend()
	if (!(await topics.is_complete()).result)
		throw new Error("the claim topics have a topic with no trusted issuer")
	console.log(`claim_topics requires topic ${KYC_TOPIC} from claim_issuer`)

	// The issuer accepts a key only for a topic the topics contract trusts it on.
	const { Client: ClaimIssuer } = (await import(
		clientEntry("claim_issuer")
	)) as typeof ClaimIssuerModule
	const issuer = new ClaimIssuer(
		clientOptions(net, contracts.claim_issuer, kyc, server),
	)
	await (
		await issuer.allow_key({
			public_key: kyc.rawPublicKey(),
			registry: contracts.claim_topics,
			claim_topic: KYC_TOPIC,
		})
	).signAndSend()
	console.log("claim_issuer accepts claims signed by kyc-provider")

	const { Client: IdentityRegistry } = (await import(
		clientEntry("identity_registry")
	)) as typeof IdentityRegistryModule
	const registry = new IdentityRegistry(
		clientOptions(net, contracts.identity_registry, governance, server),
	)
	await (
		await registry.bind_verifier({ verifier: contracts.identity_verifier })
	).signAndSend()
	if ((await registry.verifier()).result !== contracts.identity_verifier)
		throw new Error("the identity registry does not check with the verifier")
	console.log("identity_registry checks claims with identity_verifier")

	const { Client: IdentityVerifier } = (await import(
		clientEntry("identity_verifier")
	)) as typeof IdentityVerifierModule
	const verifier = new IdentityVerifier(
		clientOptions(net, contracts.identity_verifier, governance, server),
	)
	await closeSetup("claim_topics", topics, vault)
	await closeSetup("identity_registry", registry, vault)
	await closeSetup("identity_verifier", verifier, vault)

	if (!(await verifier.is_protocol_address({ account: vault })).result)
		throw new Error("the vault is not a protocol address of the verifier")
	console.log("vault is a protocol address of identity_verifier")
	if (!(await verifier.ready_for({ vault, governance: operator })).result)
		throw new Error("the identity verifier is not ready for the vault")
	console.log("identity_verifier is ready for the vault")
}

// The vault mints and burns, so it needs the token's manager role; and
// compliance only runs its hooks for a bound token, so the share token must
// be bound to it.
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

	const backup = accounts["compliance-backup"].publicKey()
	await (
		await token.grant_role({ account: backup, role: "compliance", caller })
	).signAndSend()
	const holders = (await token.get_role_member_count({ role: "compliance" }))
		.result
	if (holders !== 2)
		throw new Error("the share token needs a backup compliance holder")
	console.log("share_token has a backup compliance holder")

	// Grants are instant only during setup, so the token's setup closes after them.
	await (await token.bind_vault({ vault })).signAndSend()
	await (await token.finish_setup()).signAndSend()
	if ((await token.setup_open()).result)
		throw new Error("the share token's setup did not finish")
	console.log("share_token bound to the vault, setup finished")

	await wireIdentity(net, accounts, contracts, server)

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

	// Set while setup is open, so a silent manager never leaves only they able
	// to seal an epoch: afterwards this changes only through the timelock.
	const minEpochDurationSecs = BigInt(net.vault.min_epoch_duration_secs)
	await (
		await vault.set_min_epoch_duration({ secs: minEpochDurationSecs })
	).signAndSend()
	const minEpochDuration = (await vault.min_epoch_duration()).result
	if (minEpochDuration !== minEpochDurationSecs)
		throw new Error(
			`vault minimum epoch duration is ${minEpochDuration}, expected ${minEpochDurationSecs}`,
		)
	console.log(
		`vault minimum epoch duration set to ${minEpochDurationSecs} seconds`,
	)

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
		"identity_ready",
		"vault_unfrozen",
		"compliance_bound",
		"compliance_governed",
		"decimals_match",
		"addresses_distinct",
		"custodian_set",
		"feed_answers",
	] as const
	const broken = wiring.filter((flag) => !health[flag])
	if (health.setup_open || broken.length > 0)
		throw new Error(`the vault is not wired: ${broken.join(", ")}`)
}

// The feed carries no state of its own, so following the vault means naming
// it and quoting its asset and its share token: anything else is a feed
// bound to the wrong vault, including a copy deployed against one that
// happens to answer the same asset and share token.
export async function verifyFeed(
	net: Network,
	accounts: Accounts,
	record: Deployment,
	server: rpc.Server,
): Promise<void> {
	const { Client: Sep40Feed } = (await import(
		clientEntry("sep40_feed")
	)) as typeof Sep40FeedModule
	const feed = new Sep40Feed(
		clientOptions(net, record.contracts.sep40_feed, accounts.outsider, server),
	)
	const vault = (await feed.vault()).result
	const base = (await feed.base()).result
	const assets = (await feed.assets()).result
	const expectedBase = stellarAsset(record.asset.contract)
	const expectedAssets = [stellarAsset(record.contracts.share_token)]
	const follows =
		vault === record.contracts.async_vault &&
		JSON.stringify(base) === JSON.stringify(expectedBase) &&
		JSON.stringify(assets) === JSON.stringify(expectedAssets)
	if (!follows) {
		throw new Error(
			"sep40_feed does not name the vault, or does not quote its asset and its share token",
		)
	}
	console.log("sep40_feed follows the vault")
}

async function freshSet(
	net: Network,
	wasms: Record<WasmName, string>,
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
		feedCommit: provenance.commit,
		feedUncommittedChanges: provenance.uncommittedChanges,
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
		WASM_NAMES.map((name) => [name, wasmOf(name)]),
	) as Record<WasmName, string>
	wasms.async_vault = vaultWasm
	const provenance = readProvenance(REPO_ROOT, wasms)
	const keys = throwawayAccounts()
	const server = withAccountRetry(
		new rpc.Server(net.rpcUrl, { allowHttp: net.name === "local" }),
	)
	const deployment = await freshSet(net, wasms, provenance, keys, server)
	await grantAndVerify(net, keys, deployment.contracts, server)
	await finishVaultSetup(net, keys, deployment.contracts, server)
	await verifyFeed(net, keys, deployment, server)
	return { deployment, keys }
}

async function main(): Promise<void> {
	requireWasm()
	const net = network()
	refuseIncomplete(net.name)
	console.log(`deploying to ${net.name} (${net.rpcUrl})`)
	const wasms = Object.fromEntries(
		WASM_NAMES.map((name) => [name, wasmOf(name)]),
	) as Record<WasmName, string>
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

	for (const name of WASM_NAMES) {
		await generateClient(
			clientDir(name),
			wasmGenerator(wasmOf(name)),
			sdkVersion,
		)
	}
	console.log("clients generated")

	await grantAndVerify(net, accounts, record.contracts, server)
	await finishVaultSetup(net, accounts, record.contracts, server)
	await verifyFeed(net, accounts, record, server)

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

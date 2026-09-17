import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { Asset, rpc, type Keypair } from "@stellar/stellar-sdk"
import { basicNodeSigner } from "@stellar/stellar-sdk/contract"

import type * as ComplianceModule from "../../app-lib/clients/compliance/dist/index.js"
import type * as IdentityVerifierModule from "../../app-lib/clients/identity_verifier/dist/index.js"
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

const wasmOf = (name: ContractName): string =>
	join(REPO_ROOT, "target", "wasm32v1-none", "release", `${name}.wasm`)

const clientDir = (name: ContractName): string =>
	join(REPO_ROOT, "app-lib", "clients", name)

const clientEntry = (name: ContractName): string =>
	pathToFileURL(join(clientDir(name), "dist", "index.js")).href

function requireWasm(): void {
	const missing = CONTRACT_NAMES.filter((name) => !existsSync(wasmOf(name)))
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
): Promise<Record<ContractName, string>> {
	const pk = (name: keyof Accounts): string => accounts[name].publicKey()
	const deployer = accounts.deployer
	const governance = pk("governance")

	const compliance = await deployContract(net, wasmOf("compliance"), deployer, {
		admin: governance,
	})
	console.log("compliance", compliance)

	const identityVerifier = await deployContract(
		net,
		wasmOf("identity_verifier"),
		deployer,
		{ admin: governance },
	)
	console.log("identity_verifier", identityVerifier)

	const shareToken = await deployContract(
		net,
		wasmOf("share_token"),
		deployer,
		{
			name: "Strata Vault USDC",
			symbol: "bvUSDC",
			admin: governance,
			manager: governance,
			compliance,
			identity_verifier: identityVerifier,
		},
	)
	console.log("share_token", shareToken)

	const navOracle = await deployContract(net, wasmOf("nav_oracle"), deployer, {
		admin: governance,
		attester: pk("attester"),
		guardian: pk("guardian"),
		config: JSON.stringify(net.oracle),
	})
	console.log("nav_oracle", navOracle)

	const asyncVault = await deployContract(
		net,
		wasmOf("async_vault"),
		deployer,
		{
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
		},
	)
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
	if (role === undefined)
		throw new Error("the vault did not receive the share token's manager role")
	console.log("vault holds share_token manager role")

	const { Client: IdentityVerifier } = (await import(
		clientEntry("identity_verifier")
	)) as typeof IdentityVerifierModule
	const verifier = new IdentityVerifier(
		clientOptions(net, contracts.identity_verifier, governance),
	)
	await (
		await verifier.allow({ account: vault, allowed: true, caller })
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
}

async function main(): Promise<void> {
	requireWasm()
	const net = network()
	const server = new rpc.Server(net.rpcUrl, { allowHttp: net.name === "local" })
	console.log(`deploying to ${net.name} (${net.rpcUrl})`)

	const accounts = freshAccounts()
	await fund(net, server, Object.values(accounts))
	console.log(`funded ${Object.keys(accounts).length} accounts`)

	const asset = new Asset("USDC", accounts.issuer.publicKey())
	const assetContract = await deployAssetContract(net, asset, accounts.issuer)
	console.log("asset contract", assetContract)

	const contracts = await deployContracts(net, accounts, assetContract)

	for (const name of CONTRACT_NAMES) {
		await generateClient(wasmOf(name), clientDir(name))
	}
	console.log("clients generated")

	await grantAndVerify(net, accounts, contracts)

	const record: Deployment = {
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
	saveDeployment(record)
	console.log(`wrote deployed.${net.name}.json`)
	if (net.name === "testnet") {
		console.log("updated environments.toml [staging.contracts]")
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})

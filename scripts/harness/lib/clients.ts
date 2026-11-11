import { Asset, rpc, type Keypair, type xdr } from "@stellar/stellar-sdk"
import { basicNodeSigner } from "@stellar/stellar-sdk/contract"

import { Client as VaultClient } from "../../../app-lib/clients/async_vault/dist/index.js"
import { Client as ComplianceClient } from "../../../app-lib/clients/compliance/dist/index.js"
import { Client as IdentityVerifierClient } from "../../../app-lib/clients/identity_verifier/dist/index.js"
import { Client as OracleClient } from "../../../app-lib/clients/nav_oracle/dist/index.js"
import { Client as Sep40ConsumerClient } from "../../../app-lib/clients/sep40_consumer/dist/index.js"
import { Client as Sep40FeedClient } from "../../../app-lib/clients/sep40_feed/dist/index.js"
import { Client as ShareTokenClient } from "../../../app-lib/clients/share_token/dist/index.js"
import { type Accounts } from "./accounts.js"
import { assetBalance } from "./balances.js"
import {
	loadDeployment,
	publicKeysOf,
	REPO_ROOT,
	type ContractName,
	type Deployment,
} from "./deployment.js"
import { keysFor } from "./keys.js"
import { network, type Network } from "./network.js"
import { withAccountRetry } from "./rpc.js"

export interface Connected {
	net: Network
	deployment: Deployment
	keys: Accounts
	server: rpc.Server
	asset: Asset
}

export function connect(): Connected {
	const net = network()
	const deployment = loadDeployment(net.name)
	const keys = keysFor(deployment, REPO_ROOT)
	// An older record also holds secret keys; keep only the public ones in memory.
	return connectTo(net, { ...deployment, accounts: publicKeysOf(keys) }, keys)
}

export function connectTo(
	net: Network,
	deployment: Deployment,
	keys: Accounts,
): Connected {
	return {
		net,
		deployment,
		keys,
		server: withAccountRetry(
			new rpc.Server(net.rpcUrl, { allowHttp: net.name === "local" }),
		),
		asset: new Asset(deployment.asset.code, deployment.asset.issuer),
	}
}

function optionsFor(c: Connected, contractId: string, as: Keypair) {
	return {
		contractId,
		rpcUrl: c.net.rpcUrl,
		networkPassphrase: c.net.passphrase,
		allowHttp: c.net.name === "local",
		publicKey: as.publicKey(),
		server: c.server,
		...basicNodeSigner(as, c.net.passphrase),
	}
}

function options(c: Connected, contract: ContractName, as: Keypair) {
	return optionsFor(c, c.deployment.contracts[contract], as)
}

export const vault = (c: Connected, as: Keypair) =>
	new VaultClient(options(c, "async_vault", as))
export const oracle = (c: Connected, as: Keypair) =>
	new OracleClient(options(c, "nav_oracle", as))
export const shareToken = (c: Connected, as: Keypair) =>
	new ShareTokenClient(options(c, "share_token", as))
export const identityVerifier = (c: Connected, as: Keypair) =>
	new IdentityVerifierClient(options(c, "identity_verifier", as))
export const complianceContract = (c: Connected, as: Keypair) =>
	new ComplianceClient(options(c, "compliance", as))
export const sep40Feed = (c: Connected, as: Keypair) =>
	new Sep40FeedClient(options(c, "sep40_feed", as))
// The consumer is deployed ad hoc, not part of the standing record, so it is
// named by its contract id rather than a ContractName.
export const sep40Consumer = (c: Connected, contractId: string, as: Keypair) =>
	new Sep40ConsumerClient(optionsFor(c, contractId, as))

interface Sendable<T> {
	simulation?: unknown
	signAndSend(options?: { force?: boolean }): Promise<{
		result: T
		sendTransactionResponse?: { hash: string }
	}>
}

// A label makes the run print `tx <label> <hash>`, so a scenario can be
// linked to an explorer afterwards. `force` sends a call that simulates as a
// read; off by default so a write that turned into a no-op still fails.
export async function send<T>(
	tx: Promise<Sendable<T>>,
	label?: string,
	{ force = false }: { force?: boolean } = {},
): Promise<T> {
	const awaited = await tx
	const simulation = awaited.simulation as { error?: string } | undefined
	if (simulation?.error !== undefined) {
		throw new Error(`simulation failed: ${simulation.error}`)
	}
	const sent = await awaited.signAndSend({ force })
	const hash = sent.sendTransactionResponse?.hash
	if (label !== undefined && hash !== undefined) {
		console.log(`tx ${label} ${hash}`)
	}
	return sent.result
}

export function usdcBalance(c: Connected, address: string): Promise<bigint> {
	return assetBalance(c.server, address, c.asset, c.net.passphrase)
}

// The simulation's own events, read before the transaction is sent.
export function simulationEvents(tx: {
	simulation?: { events: xdr.DiagnosticEvent[] }
}): readonly xdr.DiagnosticEvent[] {
	return tx.simulation?.events ?? []
}

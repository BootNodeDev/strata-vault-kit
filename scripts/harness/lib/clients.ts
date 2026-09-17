import { Asset, Keypair, rpc } from "@stellar/stellar-sdk"
import { basicNodeSigner } from "@stellar/stellar-sdk/contract"

import { Client as VaultClient } from "../../../app-lib/clients/async_vault/dist/index.js"
import { Client as IdentityVerifierClient } from "../../../app-lib/clients/identity_verifier/dist/index.js"
import { Client as OracleClient } from "../../../app-lib/clients/nav_oracle/dist/index.js"
import { Client as ShareTokenClient } from "../../../app-lib/clients/share_token/dist/index.js"
import { ACCOUNT_NAMES, type AccountName } from "./accounts.js"
import {
	loadDeployment,
	type ContractName,
	type Deployment,
} from "./deployment.js"
import { network, type Network } from "./network.js"

export interface Connected {
	net: Network
	deployment: Deployment
	keys: Record<AccountName, Keypair>
	server: rpc.Server
	asset: Asset
}

export function connect(): Connected {
	const net = network()
	const deployment = loadDeployment(net.name)
	const keys = Object.fromEntries(
		ACCOUNT_NAMES.map((name) => [
			name,
			Keypair.fromSecret(deployment.accounts[name].secret),
		]),
	) as Record<AccountName, Keypair>
	return {
		net,
		deployment,
		keys,
		server: new rpc.Server(net.rpcUrl, { allowHttp: net.name === "local" }),
		asset: new Asset(deployment.asset.code, deployment.asset.issuer),
	}
}

function options(c: Connected, contract: ContractName, as: Keypair) {
	return {
		contractId: c.deployment.contracts[contract],
		rpcUrl: c.net.rpcUrl,
		networkPassphrase: c.net.passphrase,
		allowHttp: c.net.name === "local",
		publicKey: as.publicKey(),
		...basicNodeSigner(as, c.net.passphrase),
	}
}

export const vault = (c: Connected, as: Keypair) =>
	new VaultClient(options(c, "async_vault", as))
export const oracle = (c: Connected, as: Keypair) =>
	new OracleClient(options(c, "nav_oracle", as))
export const shareToken = (c: Connected, as: Keypair) =>
	new ShareTokenClient(options(c, "share_token", as))
export const identityVerifier = (c: Connected, as: Keypair) =>
	new IdentityVerifierClient(options(c, "identity_verifier", as))

interface Sendable<T> {
	simulation?: unknown
	signAndSend(): Promise<{ result: T }>
}

export async function send<T>(tx: Promise<Sendable<T>>): Promise<T> {
	const awaited = await tx
	const simulation = awaited.simulation as { error?: string } | undefined
	if (simulation?.error !== undefined) {
		throw new Error(`simulation failed: ${simulation.error}`)
	}
	return (await awaited.signAndSend()).result
}

export async function usdcBalance(
	c: Connected,
	address: string,
): Promise<bigint> {
	try {
		const { balanceEntry } = await c.server.getAssetBalance(
			address,
			c.asset,
			c.net.passphrase,
		)
		return BigInt(balanceEntry?.amount ?? "0")
	} catch (error) {
		if (
			error instanceof Error &&
			/Trustline for .* not found for/.test(error.message)
		)
			return 0n
		throw error
	}
}

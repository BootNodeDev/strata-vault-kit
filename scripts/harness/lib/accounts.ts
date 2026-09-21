import { setTimeout as sleep } from "node:timers/promises"

import {
	BASE_FEE,
	Keypair,
	Operation,
	TransactionBuilder,
	rpc,
	type Asset,
	type Transaction,
} from "@stellar/stellar-sdk"

import { type Network } from "./network.js"

export const ACCOUNT_NAMES = [
	"deployer",
	"governance",
	"manager",
	"treasury",
	"guardian",
	"compliance",
	"attester",
	"custodian",
	"issuer",
	"holder-1",
	"holder-2",
	"holder-3",
	"outsider",
] as const

export type AccountName = (typeof ACCOUNT_NAMES)[number]
export type Accounts = Record<AccountName, Keypair>

export function freshAccounts(): Accounts {
	return Object.fromEntries(
		ACCOUNT_NAMES.map((name) => [name, Keypair.random()]),
	) as Accounts
}

export async function submit(
	server: rpc.Server,
	tx: Transaction,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
	const sent = await server.sendTransaction(tx)
	if (sent.status !== "PENDING") {
		throw new Error(
			`transaction refused: ${sent.status} ${sent.errorResult?.toXDR("base64") ?? ""}`,
		)
	}
	const done = await server.pollTransaction(sent.hash, { attempts: 30 })
	if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
		throw new Error(`transaction ${sent.hash} ended ${done.status}`)
	}
	return done
}

const STARTING_BALANCE = "10000"

async function fundFromRoot(
	net: Network,
	server: rpc.Server,
	secret: string,
	keys: readonly Keypair[],
): Promise<void> {
	const root = Keypair.fromSecret(secret)
	const account = await server.getAccount(root.publicKey())
	const builder = new TransactionBuilder(account, {
		fee: BASE_FEE,
		networkPassphrase: net.passphrase,
	})
	for (const key of keys) {
		builder.addOperation(
			Operation.createAccount({
				destination: key.publicKey(),
				startingBalance: STARTING_BALANCE,
			}),
		)
	}
	const tx = builder.setTimeout(60).build()
	tx.sign(root)
	await submit(server, tx)
}

async function fundFromFriendbot(
	url: string,
	keys: readonly Keypair[],
): Promise<void> {
	for (const key of keys) {
		let ok = false
		let last = ""
		for (let attempt = 1; attempt <= 5 && !ok; attempt += 1) {
			try {
				const response = await fetch(`${url}?addr=${key.publicKey()}`)
				ok = response.ok
				last = `${response.status} ${response.statusText}`
			} catch (error) {
				last = error instanceof Error ? error.message : String(error)
			}
			if (!ok) await sleep(attempt * 2_000)
		}
		if (!ok)
			throw new Error(`friendbot did not fund ${key.publicKey()}: ${last}`)
	}
}

async function awaitVisible(
	server: rpc.Server,
	publicKey: string,
): Promise<void> {
	const attempts = 5
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			await server.getAccount(publicKey)
			return
		} catch (error) {
			if (attempt === attempts) throw error
			await sleep(2_000)
		}
	}
}

export async function fund(
	net: Network,
	server: rpc.Server,
	keys: readonly Keypair[],
): Promise<void> {
	if (net.funding.kind === "root") {
		await fundFromRoot(net, server, net.funding.secret, keys)
	} else {
		await fundFromFriendbot(net.funding.url, keys)
	}
	for (const key of keys) await awaitVisible(server, key.publicKey())
}

async function operate(
	net: Network,
	server: rpc.Server,
	signer: Keypair,
	operation:
		| ReturnType<typeof Operation.changeTrust>
		| ReturnType<typeof Operation.payment>,
): Promise<void> {
	const account = await server.getAccount(signer.publicKey())
	const tx = new TransactionBuilder(account, {
		fee: BASE_FEE,
		networkPassphrase: net.passphrase,
	})
		.addOperation(operation)
		.setTimeout(60)
		.build()
	tx.sign(signer)
	await submit(server, tx)
}

export function trustline(
	net: Network,
	server: rpc.Server,
	holder: Keypair,
	asset: Asset,
) {
	return operate(net, server, holder, Operation.changeTrust({ asset }))
}

export function pay(
	net: Network,
	server: rpc.Server,
	from: Keypair,
	to: string,
	asset: Asset,
	amount: string,
) {
	return operate(
		net,
		server,
		from,
		Operation.payment({ destination: to, asset, amount }),
	)
}

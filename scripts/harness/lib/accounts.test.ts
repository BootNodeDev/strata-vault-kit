import {
	Account,
	Keypair,
	Networks,
	rpc,
	type Operation,
	type Transaction,
} from "@stellar/stellar-sdk"
import { afterEach, describe, expect, it, vi } from "vitest"

import { fund } from "./accounts.js"
import { type Funding, type Network } from "./network.js"

const networkWith = (funding: Funding): Network => ({
	name: "local",
	rpcUrl: "http://localhost:8000/rpc",
	passphrase: Networks.STANDALONE,
	funding,
	oracle: {
		freshness_duration: 300,
		cooldown_secs: 5,
		max_up_bps: 1000,
		max_down_bps: 10_000,
		min_answer: "1",
		max_answer: "2",
	},
	vault: { notice_secs: 10 },
})

// Knows which accounts exist, and creates the ones a transaction creates.
function fakeServer(existing: Set<string>) {
	const created: string[][] = []
	const server = {
		getAccount(publicKey: string): Promise<Account> {
			if (!existing.has(publicKey))
				return Promise.reject(new Error(`Account not found: ${publicKey}`))
			return Promise.resolve(new Account(publicKey, "1"))
		},
		sendTransaction(tx: Transaction) {
			const destinations = tx.operations.map(
				(op) => (op as Operation.CreateAccount).destination,
			)
			created.push(destinations)
			for (const destination of destinations) existing.add(destination)
			return Promise.resolve({ status: "PENDING", hash: "hash" })
		},
		pollTransaction() {
			return Promise.resolve({
				status: rpc.Api.GetTransactionStatus.SUCCESS,
			})
		},
	}
	return { server: server as unknown as rpc.Server, created }
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("fund from the root account", () => {
	const root = Keypair.random()
	const net = networkWith({ kind: "root", secret: root.secret() })

	it("creates only the accounts that do not exist yet", async () => {
		const [known, fresh1, fresh2] = [0, 1, 2].map(() => Keypair.random())
		const { server, created } = fakeServer(
			new Set([root.publicKey(), known!.publicKey()]),
		)

		const funded = await fund(net, server, [known!, fresh1!, fresh2!])

		expect(funded).toBe(2)
		expect(created).toEqual([[fresh1!.publicKey(), fresh2!.publicKey()]])
	})

	it("sends nothing when every account exists", async () => {
		const keys = [Keypair.random(), Keypair.random()]
		const { server, created } = fakeServer(
			new Set([root.publicKey(), ...keys.map((key) => key.publicKey())]),
		)

		expect(await fund(net, server, keys)).toBe(0)
		expect(created).toEqual([])
	})
})

describe("fund from friendbot", () => {
	const url = "https://friendbot.example"
	const net = networkWith({ kind: "friendbot", url })

	it("asks only for the accounts that do not exist yet", async () => {
		const [known, fresh] = [Keypair.random(), Keypair.random()]
		const existing = new Set([known.publicKey()])
		const { server } = fakeServer(existing)
		const asked: string[] = []
		vi.stubGlobal("fetch", (request: string) => {
			const address = new URL(request).searchParams.get("addr") ?? ""
			asked.push(address)
			existing.add(address)
			return Promise.resolve(new Response("{}"))
		})

		const funded = await fund(net, server, [known, fresh])

		expect(funded).toBe(1)
		expect(asked).toEqual([fresh.publicKey()])
	})
})

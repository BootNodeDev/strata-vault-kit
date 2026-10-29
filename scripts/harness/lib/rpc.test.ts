import { Account, Keypair, type rpc } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { withAccountRetry } from "./rpc.js"

function fakeServer(outcomes: (() => Promise<Account>)[]) {
	let calls = 0
	const server = {
		getAccount(): Promise<Account> {
			const outcome = outcomes[calls] ?? outcomes[outcomes.length - 1]
			calls += 1
			return outcome!()
		},
	}
	return { server: server as unknown as rpc.Server, callCount: () => calls }
}

const address = Keypair.random().publicKey()
const notFound = () =>
	Promise.reject(new Error(`Account not found: ${address}`))
const found = () => Promise.resolve(new Account(address, "1"))

// Skips the production retry interval so the suite runs in milliseconds.
const noWait = () => Promise.resolve()

describe("withAccountRetry", () => {
	it("returns the account once a retry succeeds", async () => {
		const { server, callCount } = fakeServer([notFound, notFound, found])

		const account = await withAccountRetry(server, noWait).getAccount(address)

		expect(account.accountId()).toBe(address)
		expect(callCount()).toBe(3)
	})

	it("rethrows the error once the attempts run out", async () => {
		const { server, callCount } = fakeServer([notFound])

		await expect(
			withAccountRetry(server, noWait).getAccount(address),
		).rejects.toThrow(`Account not found: ${address}`)
		expect(callCount()).toBe(10)
	})

	it("rethrows any other error at once", async () => {
		const { server, callCount } = fakeServer([
			() => Promise.reject(new Error("socket hang up")),
		])

		await expect(
			withAccountRetry(server, noWait).getAccount(address),
		).rejects.toThrow("socket hang up")
		expect(callCount()).toBe(1)
	})
})

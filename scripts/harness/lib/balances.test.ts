import { Asset, Keypair, xdr, type rpc } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import {
	assetBalance,
	classicAmount,
	returnToIssuer,
	trustlineBalance,
} from "./balances.js"

const trustlineKey = (account: string, asset: Asset): xdr.LedgerKey =>
	xdr.LedgerKey.trustline(
		new xdr.LedgerKeyTrustLine({
			accountId: Keypair.fromPublicKey(account).xdrAccountId(),
			asset: asset.toTrustLineXDRObject(),
		}),
	)

const trustlineEntry = (account: string, asset: Asset, balance: bigint) =>
	xdr.LedgerEntryData.trustline(
		new xdr.TrustLineEntry({
			accountId: Keypair.fromPublicKey(account).xdrAccountId(),
			asset: asset.toTrustLineXDRObject(),
			balance: xdr.Int64.fromString(balance.toString()),
			limit: xdr.Int64.fromString("9223372036854775807"),
			flags: 1,
			ext: new xdr.TrustLineEntryExt(0),
		}),
	)

function fakeLedger(balances: Map<string, bigint>, asset: Asset) {
	const requestedKeys: string[] = []
	const getLedgerEntries = (...keys: xdr.LedgerKey[]) => {
		const [key] = keys
		if (key === undefined) throw new Error("no key requested")
		const keyXdr = key.toXDR("base64")
		requestedKeys.push(keyXdr)
		for (const [account, balance] of balances) {
			if (trustlineKey(account, asset).toXDR("base64") !== keyXdr) continue
			return Promise.resolve({
				entries: [{ val: trustlineEntry(account, asset, balance) }],
				latestLedger: 1,
			})
		}
		return Promise.resolve({ entries: [], latestLedger: 1 })
	}
	return { getLedgerEntries, requestedKeys } as unknown as rpc.Server & {
		requestedKeys: string[]
	}
}

describe("trustlineBalance", () => {
	it("reads the balance from the account's trustline entry", async () => {
		const asset = new Asset("USDC", Keypair.random().publicKey())
		const holder = Keypair.random()
		const server = fakeLedger(new Map([[holder.publicKey(), 1234567n]]), asset)

		const balance = await trustlineBalance(server, holder.publicKey(), asset)

		expect(balance).toBe(1234567n)
		expect(server.requestedKeys).toEqual([
			trustlineKey(holder.publicKey(), asset).toXDR("base64"),
		])
	})

	it("answers undefined for an account with no trustline", async () => {
		const asset = new Asset("USDC", Keypair.random().publicKey())
		const holder = Keypair.random()
		const server = fakeLedger(new Map(), asset)

		expect(
			await trustlineBalance(server, holder.publicKey(), asset),
		).toBeUndefined()
	})

	it("passes an RPC failure through instead of reading it as no trustline", async () => {
		const asset = new Asset("USDC", Keypair.random().publicKey())
		const server = {
			getLedgerEntries: () => Promise.reject(new Error("connect ECONNREFUSED")),
		} as unknown as rpc.Server

		await expect(
			trustlineBalance(server, Keypair.random().publicKey(), asset),
		).rejects.toThrow(/ECONNREFUSED/)
	})
})

describe("assetBalance", () => {
	it("reads zero for an account with no trustline", async () => {
		const asset = new Asset("USDC", Keypair.random().publicKey())
		const holder = Keypair.random()
		const server = fakeLedger(new Map(), asset)

		expect(
			await assetBalance(server, holder.publicKey(), asset, "passphrase"),
		).toBe(0n)
	})

	it("reads a contract's balance through the asset contract", async () => {
		const asset = new Asset("USDC", Keypair.random().publicKey())
		const contract = "CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD5"

		const withBalance = {
			getAssetBalance: () =>
				Promise.resolve({
					latestLedger: 1,
					balanceEntry: { amount: "500" },
				}),
		} as unknown as rpc.Server
		expect(await assetBalance(withBalance, contract, asset, "passphrase")).toBe(
			500n,
		)

		const withoutBalance = {
			getAssetBalance: () => Promise.resolve({ latestLedger: 1 }),
		} as unknown as rpc.Server
		expect(
			await assetBalance(withoutBalance, contract, asset, "passphrase"),
		).toBe(0n)
	})
})

describe("classicAmount", () => {
	it("writes stroops as a seven-decimal amount", () => {
		expect(classicAmount(10_000_000n)).toBe("1.0000000")
		expect(classicAmount(1n)).toBe("0.0000001")
		expect(classicAmount(123_456_789_012n)).toBe("12345.6789012")
	})
})

describe("returnToIssuer", () => {
	it("pays each balance back to the issuer and skips accounts with nothing to return", async () => {
		const issuer = Keypair.random()
		const asset = new Asset("USDC", issuer.publicKey())
		const a = Keypair.random()
		const b = Keypair.random()
		const c = Keypair.random()
		const server = fakeLedger(
			new Map([
				[a.publicKey(), 5n],
				[c.publicKey(), 0n],
			]),
			asset,
		)
		const paid: Array<[Keypair, string]> = []

		const result = await returnToIssuer(
			server,
			[a, b, c, issuer],
			asset,
			(from, amount) => {
				paid.push([from, amount])
				return Promise.resolve()
			},
		)

		expect(paid).toEqual([[a, "0.0000005"]])
		expect(result).toBe(1)
	})
})

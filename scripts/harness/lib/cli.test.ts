import {
	Address,
	Asset,
	Keypair,
	Networks,
	type rpc,
	type xdr,
} from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { ensureAssetContract } from "./cli.js"
import { type Network } from "./network.js"

describe("ensureAssetContract", () => {
	it("returns the asset contract already on the network", async () => {
		const net = { passphrase: Networks.STANDALONE } as Network
		const issuer = Keypair.random()
		const asset = new Asset("USDC", issuer.publicKey())
		const id = asset.contractId(net.passphrase)
		const server = {
			getLedgerEntries(key: xdr.LedgerKey) {
				const contract = Address.fromScAddress(
					key.contractData().contract(),
				).toString()
				return Promise.resolve({
					entries: contract === id ? [{}] : [],
					latestLedger: 1,
				})
			},
		} as unknown as rpc.Server

		expect(await ensureAssetContract(net, server, asset, issuer)).toBe(id)
	})
})

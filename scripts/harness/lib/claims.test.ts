import {
	Address,
	hash,
	Keypair,
	Networks,
	StrKey,
	xdr,
	type rpc,
} from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import {
	claimMessage,
	encodeClaimData,
	issuerNonce,
	networkId,
	nonceKey,
	signatureData,
} from "./claims.js"

// Printed by the claim issuer's contract test for a claim it accepts.
const VECTOR = {
	seed: Buffer.alloc(32, 7),
	networkId: Buffer.alloc(32),
	issuer: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
	identity: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
	topic: 1,
	nonce: 0,
	createdAt: 1000n,
	validUntil: 1100n,
	payload: Buffer.from("kyc-level-1"),
	claimData: "00000000000003e8000000000000044c6b79632d6c6576656c2d31",
	message:
		"01" +
		"0000000000000000000000000000000000000000000000000000000000000000" +
		"0000001200000001" +
		"0000000000000000000000000000000000000000000000000000000000000001" +
		"000000120000000000000000" +
		"0000000000000000000000000000000000000000000000000000000000000000" +
		"00000001" +
		"00000000" +
		"00000000000003e8000000000000044c6b79632d6c6576656c2d31",
	sigData:
		"ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c" +
		"eef33ad9b70c23a2eb026ff2a4a45361c076956fcef6a8516b0c23ce0dbd37d4" +
		"29dcd888e51c4bf4b7ba13fa94af7abd4e37ffbbcf1abeff262b18a880322d09",
}

const vectorData = () =>
	encodeClaimData({
		createdAt: VECTOR.createdAt,
		validUntil: VECTOR.validUntil,
		payload: VECTOR.payload,
	})

const vectorMessage = () =>
	claimMessage(
		{
			networkId: VECTOR.networkId,
			issuer: VECTOR.issuer,
			identity: VECTOR.identity,
			topic: VECTOR.topic,
			nonce: VECTOR.nonce,
		},
		vectorData(),
	)

describe("encodeClaimData", () => {
	it("puts the creation and expiry times in front of the payload", () => {
		expect(vectorData().toString("hex")).toBe(VECTOR.claimData)
	})
})

describe("claimMessage", () => {
	it("matches the message the claim issuer signs over", () => {
		expect(vectorMessage().toString("hex")).toBe(VECTOR.message)
	})

	it("binds the nonce, so a bumped nonce changes the message", () => {
		const bumped = claimMessage(
			{
				networkId: VECTOR.networkId,
				issuer: VECTOR.issuer,
				identity: VECTOR.identity,
				topic: VECTOR.topic,
				nonce: 1,
			},
			vectorData(),
		)
		expect(bumped.equals(vectorMessage())).toBe(false)
	})
})

describe("signatureData", () => {
	it("is the public key and the signature the claim issuer accepts", () => {
		const key = Keypair.fromRawEd25519Seed(VECTOR.seed)
		expect(signatureData(key, vectorMessage()).toString("hex")).toBe(
			VECTOR.sigData,
		)
	})
})

describe("networkId", () => {
	it("is the hash of the passphrase", () => {
		expect(networkId(Networks.STANDALONE)).toEqual(
			hash(Buffer.from(Networks.STANDALONE)),
		)
	})
})

const issuer = StrKey.encodeContract(Buffer.alloc(32, 4))
const identity = StrKey.encodeContract(Buffer.alloc(32, 5))

describe("nonceKey", () => {
	it("is the claim issuer's storage key for an identity and topic", () => {
		const expected = xdr.ScVal.scvVec([
			xdr.ScVal.scvSymbol("ClaimNonce"),
			new Address(identity).toScVal(),
			xdr.ScVal.scvU32(1),
		])
		expect(nonceKey(identity, 1).toXDR("hex")).toBe(expected.toXDR("hex"))
	})
})

const ledgerHolding = (nonce: number | undefined) => {
	const asked: xdr.LedgerKey[] = []
	const server = {
		getLedgerEntries(...keys: xdr.LedgerKey[]) {
			asked.push(...keys)
			const entries =
				nonce === undefined
					? []
					: keys.map((key) => ({
							key,
							val: xdr.LedgerEntryData.contractData(
								new xdr.ContractDataEntry({
									ext: new xdr.ExtensionPoint(0),
									contract: key.contractData().contract(),
									key: key.contractData().key(),
									durability: key.contractData().durability(),
									val: xdr.ScVal.scvU32(nonce),
								}),
							),
						}))
			return Promise.resolve({ entries, latestLedger: 1 })
		},
	} as unknown as Pick<rpc.Server, "getLedgerEntries">
	return { server, asked }
}

describe("issuerNonce", () => {
	it("reads the nonce from the issuer's persistent storage", async () => {
		const { server, asked } = ledgerHolding(3)

		expect(await issuerNonce(server, issuer, identity, 1)).toBe(3)

		const [key] = asked
		const data = key?.contractData()
		expect(Address.fromScAddress(data!.contract()).toString()).toBe(issuer)
		expect(data?.key().toXDR("hex")).toBe(nonceKey(identity, 1).toXDR("hex"))
		expect(data?.durability()).toEqual(xdr.ContractDataDurability.persistent())
	})

	it("is zero before the issuer has invalidated anything", async () => {
		const { server } = ledgerHolding(undefined)

		expect(await issuerNonce(server, issuer, identity, 1)).toBe(0)
	})
})

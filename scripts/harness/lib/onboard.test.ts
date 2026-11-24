import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { type SignedClaim } from "../../../app-lib/clients/identity_registry/dist/index.js"
import { claimMessage, ED25519_SCHEME, KYC_TOPIC, networkId } from "./claims.js"
import { onboardWith, type ClaimSigner, type Onboarding } from "./onboard.js"

const signer: ClaimSigner = {
	issuer: StrKey.encodeContract(Buffer.alloc(32, 1)),
	key: Keypair.random(),
	passphrase: Networks.STANDALONE,
}
const account = Keypair.random().publicKey()
const identity = StrKey.encodeContract(Buffer.alloc(32, 2))
const LEDGER_TIME = 1_800_000_000n
const YEAR_SECS = 365n * 24n * 60n * 60n

function registrar(opts: { stored?: string; nonce?: number } = {}) {
	const calls: string[] = []
	const sent: SignedClaim[][] = []
	const ports: Onboarding = {
		storedIdentity: (who) => {
			calls.push(`stored_identity ${who}`)
			return Promise.resolve(opts.stored)
		},
		identityAddress: (who) => {
			calls.push(`identity_address ${who}`)
			return Promise.resolve(identity)
		},
		nonce: (of) => {
			calls.push(`nonce ${of}`)
			return Promise.resolve(opts.nonce ?? 0)
		},
		ledgerTime: () => Promise.resolve(LEDGER_TIME),
		onboard: (who, claims) => {
			calls.push(`onboard ${who}`)
			sent.push(claims)
			return Promise.resolve(identity)
		},
	}
	return { ports, calls, sent }
}

const onlyClaim = (sent: SignedClaim[][]): SignedClaim => {
	expect(sent).toHaveLength(1)
	expect(sent[0]).toHaveLength(1)
	return sent[0]![0]!
}

const signs = (claim: SignedClaim, nonce: number, about: string): boolean =>
	signer.key.verify(
		claimMessage(
			{
				networkId: networkId(signer.passphrase),
				issuer: signer.issuer,
				identity: about,
				topic: KYC_TOPIC,
				nonce,
			},
			claim.data,
		),
		claim.signature.subarray(32),
	)

describe("onboardWith", () => {
	it("signs a KYC claim for the identity the registry will deploy", async () => {
		const { ports, calls, sent } = registrar()

		const result = await onboardWith(ports, signer, account)

		expect(result).toEqual({ identity, created: true })
		expect(calls).toEqual([
			`stored_identity ${account}`,
			`identity_address ${account}`,
			`nonce ${identity}`,
			`onboard ${account}`,
		])
		const claim = onlyClaim(sent)
		expect(claim.topic).toBe(KYC_TOPIC)
		expect(claim.scheme).toBe(ED25519_SCHEME)
		expect(claim.issuer).toBe(signer.issuer)
		expect(claim.signature.subarray(0, 32)).toEqual(signer.key.rawPublicKey())
		expect(signs(claim, 0, identity)).toBe(true)
		expect(signs(claim, 0, account)).toBe(false)
	})

	it("signs with the issuer's current nonce", async () => {
		const { ports, sent } = registrar({ nonce: 2 })

		await onboardWith(ports, signer, account)

		const claim = onlyClaim(sent)
		expect(signs(claim, 2, identity)).toBe(true)
		expect(signs(claim, 0, identity)).toBe(false)
	})

	it("dates the claim before the ledger's time and keeps it valid for a year", async () => {
		const { ports, sent } = registrar()

		await onboardWith(ports, signer, account)

		const { data } = onlyClaim(sent)
		const createdAt = data.readBigUInt64BE(0)
		const validUntil = data.readBigUInt64BE(8)
		expect(createdAt).toBeLessThan(LEDGER_TIME)
		expect(createdAt).toBeGreaterThan(LEDGER_TIME - 600n)
		expect(validUntil).toBe(createdAt + YEAR_SECS)
	})

	it("leaves an account that is already registered alone", async () => {
		const { ports, calls, sent } = registrar({ stored: identity })

		const result = await onboardWith(ports, signer, account)

		expect(result).toEqual({ identity, created: false })
		expect(calls).toEqual([`stored_identity ${account}`])
		expect(sent).toEqual([])
	})
})

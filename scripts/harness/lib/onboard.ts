import { type Keypair } from "@stellar/stellar-sdk"

import { type SignedClaim } from "../../../app-lib/clients/identity_registry/dist/index.js"
import {
	claimMessage,
	ED25519_SCHEME,
	encodeClaimData,
	issuerNonce,
	KYC_TOPIC,
	networkId,
	signatureData,
} from "./claims.js"
import {
	identityRegistry,
	identityVerifier,
	send,
	type Connected,
} from "./clients.js"

// The issuer refuses a claim dated after the ledger's time.
const BACKDATE_SECS = 60n
const CLAIM_LIFETIME_SECS = 365n * 24n * 60n * 60n
// The kit never reads the payload; a test claim carries no personal data.
const KYC_PAYLOAD = Buffer.from("harness test claim")
const IDENTITY_NOT_FOUND = /Error\(Contract, #321\)/

export interface ClaimSigner {
	issuer: string
	key: Keypair
	passphrase: string
}

export interface Onboarding {
	storedIdentity(account: string): Promise<string | undefined>
	identityAddress(account: string): Promise<string>
	nonce(identity: string): Promise<number>
	ledgerTime(): Promise<bigint>
	onboard(account: string, claims: SignedClaim[]): Promise<string>
}

function kycClaim(
	signer: ClaimSigner,
	identity: string,
	nonce: number,
	ledgerTime: bigint,
): SignedClaim {
	const createdAt = ledgerTime - BACKDATE_SECS
	const data = encodeClaimData({
		createdAt,
		validUntil: createdAt + CLAIM_LIFETIME_SECS,
		payload: KYC_PAYLOAD,
	})
	const message = claimMessage(
		{
			networkId: networkId(signer.passphrase),
			issuer: signer.issuer,
			identity,
			topic: KYC_TOPIC,
			nonce,
		},
		data,
	)
	return {
		topic: KYC_TOPIC,
		scheme: ED25519_SCHEME,
		issuer: signer.issuer,
		signature: signatureData(signer.key, message),
		data,
		uri: "",
	}
}

async function signedFor(
	ports: Pick<Onboarding, "identityAddress" | "nonce" | "ledgerTime">,
	signer: ClaimSigner,
	account: string,
): Promise<SignedClaim[]> {
	const identity = await ports.identityAddress(account)
	const nonce = await ports.nonce(identity)
	return [kycClaim(signer, identity, nonce, await ports.ledgerTime())]
}

export async function onboardWith(
	ports: Onboarding,
	signer: ClaimSigner,
	account: string,
): Promise<{ identity: string; created: boolean }> {
	const stored = await ports.storedIdentity(account)
	if (stored !== undefined) return { identity: stored, created: false }
	const claims = await signedFor(ports, signer, account)
	return { identity: await ports.onboard(account, claims), created: true }
}

const signerOf = (c: Connected): ClaimSigner => ({
	issuer: c.deployment.contracts.claim_issuer,
	key: c.keys["kyc-provider"],
	passphrase: c.net.passphrase,
})

async function ledgerTime(c: Connected): Promise<bigint> {
	const closeTime = Number((await c.server.getLatestLedger()).closeTime)
	return BigInt(
		Number.isFinite(closeTime) && closeTime > 0
			? closeTime
			: Math.floor(Date.now() / 1000),
	)
}

function portsFor(c: Connected, investor: Keypair): Onboarding {
	const registry = identityRegistry(c, investor)
	return {
		storedIdentity: async (account) => {
			const tx = await registry.stored_identity({ account })
			const error = (tx.simulation as { error?: string } | undefined)?.error
			if (error === undefined) return tx.result
			if (IDENTITY_NOT_FOUND.test(error)) return undefined
			throw new Error(`stored_identity failed: ${error}`)
		},
		identityAddress: async (account) =>
			(await registry.identity_address({ account })).result,
		nonce: (identity) =>
			issuerNonce(c.server, signerOf(c).issuer, identity, KYC_TOPIC),
		ledgerTime: () => ledgerTime(c),
		onboard: (account, claims) =>
			send(registry.onboard({ account, claims }), `onboard ${account}`),
	}
}

// The investor's own onboarding transaction, unsent, for a test that expects a refusal.
export async function onboardingTx(c: Connected, investor: Keypair) {
	const account = investor.publicKey()
	const claims = await signedFor(portsFor(c, investor), signerOf(c), account)
	return identityRegistry(c, investor).onboard({ account, claims })
}

// Onboards the investor with a KYC claim, unless it is already registered.
export async function onboard(
	c: Connected,
	investor: Keypair,
): Promise<string> {
	const { identity } = await onboardWith(
		portsFor(c, investor),
		signerOf(c),
		investor.publicKey(),
	)
	return identity
}

// Whether the share token's verifier lets the account in.
export async function verified(
	c: Connected,
	account: string,
): Promise<boolean> {
	const tx = await identityVerifier(c, c.keys.outsider).verify_identity({
		account,
	})
	return (tx.simulation as { error?: string } | undefined)?.error === undefined
}

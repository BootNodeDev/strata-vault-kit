import {
	Address,
	hash,
	xdr,
	type Keypair,
	type rpc,
} from "@stellar/stellar-sdk"

// The kit's single required topic, and the scheme its claim issuer verifies.
export const KYC_TOPIC = 1
export const ED25519_SCHEME = 101

const CLAIM_MESSAGE_DOMAIN = 0x01

export const networkId = (passphrase: string): Buffer =>
	hash(Buffer.from(passphrase))

export interface ClaimData {
	createdAt: bigint
	validUntil: bigint
	payload: Buffer
}

export function encodeClaimData({
	createdAt,
	validUntil,
	payload,
}: ClaimData): Buffer {
	const times = Buffer.alloc(16)
	times.writeBigUInt64BE(createdAt, 0)
	times.writeBigUInt64BE(validUntil, 8)
	return Buffer.concat([times, payload])
}

export interface ClaimSubject {
	networkId: Buffer
	issuer: string
	identity: string
	topic: number
	nonce: number
}

const addressXdr = (address: string): Buffer =>
	new Address(address).toScVal().toXDR()

const u32be = (value: number): Buffer => {
	const bytes = Buffer.alloc(4)
	bytes.writeUInt32BE(value)
	return bytes
}

// OpenZeppelin's claim message: the issuer verifies a signature over these bytes.
export function claimMessage(subject: ClaimSubject, data: Buffer): Buffer {
	return Buffer.concat([
		Buffer.from([CLAIM_MESSAGE_DOMAIN]),
		subject.networkId,
		addressXdr(subject.issuer),
		addressXdr(subject.identity),
		u32be(subject.topic),
		u32be(subject.nonce),
		data,
	])
}

export const signatureData = (key: Keypair, message: Buffer): Buffer =>
	Buffer.concat([key.rawPublicKey(), key.sign(message)])

export const nonceKey = (identity: string, topic: number): xdr.ScVal =>
	xdr.ScVal.scvVec([
		xdr.ScVal.scvSymbol("ClaimNonce"),
		new Address(identity).toScVal(),
		xdr.ScVal.scvU32(topic),
	])

// The issuer exposes no nonce getter, so the nonce is read from its storage.
export async function issuerNonce(
	server: Pick<rpc.Server, "getLedgerEntries">,
	issuer: string,
	identity: string,
	topic: number,
): Promise<number> {
	const key = xdr.LedgerKey.contractData(
		new xdr.LedgerKeyContractData({
			contract: new Address(issuer).toScAddress(),
			key: nonceKey(identity, topic),
			durability: xdr.ContractDataDurability.persistent(),
		}),
	)
	const { entries } = await server.getLedgerEntries(key)
	const [entry] = entries
	return entry === undefined ? 0 : entry.val.contractData().val().u32()
}

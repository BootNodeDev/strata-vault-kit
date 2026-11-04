import {
	Keypair,
	StrKey,
	xdr,
	type Asset,
	type rpc,
} from "@stellar/stellar-sdk"

const DECIMALS = 7
const SCALE = 10n ** BigInt(DECIMALS)

export async function trustlineBalance(
	server: Pick<rpc.Server, "getLedgerEntries">,
	account: string,
	asset: Asset,
): Promise<bigint | undefined> {
	const key = xdr.LedgerKey.trustline(
		new xdr.LedgerKeyTrustLine({
			accountId: Keypair.fromPublicKey(account).xdrAccountId(),
			asset: asset.toTrustLineXDRObject(),
		}),
	)
	const { entries } = await server.getLedgerEntries(key)
	const [entry] = entries
	if (entry === undefined) return undefined
	return BigInt(entry.val.trustLine().balance().toString())
}

export async function assetBalance(
	server: Pick<rpc.Server, "getLedgerEntries" | "getAssetBalance">,
	address: string,
	asset: Asset,
	passphrase: string,
): Promise<bigint> {
	if (StrKey.isValidEd25519PublicKey(address)) {
		return (await trustlineBalance(server, address, asset)) ?? 0n
	}
	const { balanceEntry } = await server.getAssetBalance(
		address,
		asset,
		passphrase,
	)
	return BigInt(balanceEntry?.amount ?? "0")
}

export function classicAmount(stroops: bigint): string {
	const whole = stroops / SCALE
	const fraction = stroops % SCALE
	return `${whole}.${fraction.toString().padStart(DECIMALS, "0")}`
}

export async function returnToIssuer(
	server: Pick<rpc.Server, "getLedgerEntries">,
	accounts: readonly Keypair[],
	asset: Asset,
	payBack: (from: Keypair, amount: string) => Promise<void>,
): Promise<number> {
	const issuer = asset.getIssuer()
	let paid = 0
	for (const account of accounts) {
		if (account.publicKey() === issuer) continue
		const balance = await trustlineBalance(server, account.publicKey(), asset)
		if (balance === undefined || balance === 0n) continue
		await payBack(account, classicAmount(balance))
		paid += 1
	}
	return paid
}

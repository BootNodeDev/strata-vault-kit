import { type Keypair } from "@stellar/stellar-sdk"

export interface AccountRow {
	Role: string
	PublicKey: string
	"USDC Balance": string
	"Shares Balance": string
}

export function accountRow(
	role: string,
	key: Keypair,
	usdc: string,
	shares: string,
): AccountRow {
	return {
		Role: role,
		PublicKey: key.publicKey(),
		"USDC Balance": usdc,
		"Shares Balance": shares,
	}
}

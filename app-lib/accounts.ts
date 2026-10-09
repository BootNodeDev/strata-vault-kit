import { horizon } from "./wallet"

export interface AccountSigners {
	signers: Array<{ key: string; weight: number }>
	thresholds: { low: number; med: number; high: number }
}

export async function accountSigners(
	address: string,
): Promise<AccountSigners | null> {
	if (!address.startsWith("G")) return null
	try {
		const account = await horizon.accounts().accountId(address).call()
		return {
			signers: account.signers
				.filter((signer) => signer.type === "ed25519_public_key")
				.map(({ key, weight }) => ({ key, weight })),
			thresholds: {
				low: account.thresholds.low_threshold,
				med: account.thresholds.med_threshold,
				high: account.thresholds.high_threshold,
			},
		}
	} catch {
		return null
	}
}

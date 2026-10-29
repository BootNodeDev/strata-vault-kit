import { horizon } from "./wallet"

export interface AccountSigners {
	signers: Array<{ key: string; weight: number }>
	thresholds: { low: number; med: number; high: number }
	sequence: string
}

// The network needs a source signature even when every threshold is zero.
export const requiredWeight = (account: AccountSigners): number =>
	Math.max(account.thresholds.med, 1)

export const uniformWeights = (signers: AccountSigners["signers"]): boolean =>
	signers.every(({ weight }) => weight <= 1)

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
			sequence: account.sequence,
		}
	} catch {
		return null
	}
}

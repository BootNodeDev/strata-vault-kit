import { type Keypair } from "@stellar/stellar-sdk"

import { pay, trustline } from "./accounts.js"
import { units } from "./amounts.js"
import {
	identityVerifier,
	send,
	usdcBalance,
	type Connected,
} from "./clients.js"

export function formatAmount(amount: bigint, decimals: number): string {
	const factor = 10n ** BigInt(decimals)
	const whole = amount / factor
	const fraction = amount % factor
	return `${whole}.${fraction.toString().padStart(decimals, "0").slice(0, 4)}`
}

async function hasTrustline(c: Connected, address: string): Promise<boolean> {
	try {
		await c.server.getAssetBalance(address, c.asset, c.net.passphrase)
		return true
	} catch (error) {
		if (
			error instanceof Error &&
			/Trustline for .* not found for/.test(error.message)
		) {
			return false
		}
		throw error
	}
}

export async function ensureTrustline(
	c: Connected,
	holder: Keypair,
	name: string,
): Promise<void> {
	const exists = await hasTrustline(c, holder.publicKey())
	if (!exists) {
		console.log(`  + establishing USDC trustline for ${name}...`)
		await trustline(c.net, c.server, holder, c.asset)
		console.log(`  ✓ established trustline for ${name}`)
	} else {
		console.log(`  • ${name} trustline verified`)
	}
}

export async function ensureFunding(
	c: Connected,
	holder: Keypair,
	name: string,
	minUsdcWhole: number,
	topUpUsdcWhole: number,
	decimals: number,
): Promise<void> {
	const minBalance = units(minUsdcWhole, decimals)
	const current = await usdcBalance(c, holder.publicKey())
	if (current < minBalance) {
		console.log(
			`  + funding ${name} with ${topUpUsdcWhole} USDC (current: ${formatAmount(current, decimals)})...`,
		)
		await pay(
			c.net,
			c.server,
			c.keys.issuer,
			holder.publicKey(),
			c.asset,
			topUpUsdcWhole.toString(),
		)
		const updated = await usdcBalance(c, holder.publicKey())
		console.log(
			`  ✓ funded ${name}, new balance: ${formatAmount(updated, decimals)} USDC`,
		)
	} else {
		console.log(
			`  • ${name} has sufficient USDC: ${formatAmount(current, decimals)}`,
		)
	}
}

export async function ensureAllowlist(
	c: Connected,
	holder: Keypair,
	name: string,
): Promise<void> {
	const verifier = identityVerifier(c, c.keys.compliance)
	const allowed = (await verifier.is_allowed({ account: holder.publicKey() }))
		.result
	if (!allowed) {
		console.log(`  + allowlisting ${name}...`)
		await send(
			verifier.allow({
				account: holder.publicKey(),
				allowed: true,
				caller: c.keys.compliance.publicKey(),
			}),
		)
		console.log(`  ✓ ${name} allowlisted`)
	} else {
		console.log(`  • ${name} is already allowlisted`)
	}
}

import { setTimeout as sleep } from "node:timers/promises"
import { oracle, send, type Connected } from "./clients.js"
import { outcome } from "./refused.js"

export interface NavReport {
	nav_per_share: bigint
	expires_at: bigint
	timestamp: bigint
}

/** The latest expiry a u64 holds: the oracle cuts it to its own window. */
const NO_EXPIRY = (1n << 64n) - 1n

export function navReport(nav: bigint): NavReport {
	return {
		nav_per_share: nav,
		expires_at: NO_EXPIRY,
		timestamp: 0n,
	}
}

// The cooldown is ledger time, so the second attestation of a run waits it out.
export async function attest(c: Connected, nav: bigint): Promise<void> {
	const attester = c.keys.attester
	const client = oracle(c, attester)
	const deadline = Date.now() + (c.net.oracle.cooldown_secs + 60) * 1_000
	for (;;) {
		const tx = await client.attest({
			report: navReport(nav),
			caller: attester.publicKey(),
		})
		const result = outcome(tx, client)
		if (result === "accepted") {
			await send(Promise.resolve(tx))
			return
		}
		if (result !== "refused: CooldownActive") throw new Error(result)
		if (Date.now() > deadline)
			throw new Error("the oracle never left its cooldown")
		await sleep(2_000)
	}
}

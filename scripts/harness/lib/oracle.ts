import { setTimeout as sleep } from "node:timers/promises"
import { oracle, send, type Connected } from "./clients.js"
import { outcome } from "./refused.js"

export interface NavReport {
	nav_per_share: bigint
	expires_at: bigint
	timestamp: bigint
}

export function navReport(nav: bigint, freshnessSecs: number): NavReport {
	const now = BigInt(Math.floor(Date.now() / 1000))
	return {
		nav_per_share: nav,
		expires_at: now + BigInt(freshnessSecs),
		timestamp: now,
	}
}

// The cooldown is ledger time, so the second attestation of a run waits it out.
export async function attest(c: Connected, nav: bigint): Promise<void> {
	const attester = c.keys.attester
	const client = oracle(c, attester)
	const deadline = Date.now() + (c.net.oracle.cooldown_secs + 60) * 1_000
	for (;;) {
		const tx = await client.attest({
			report: navReport(nav, c.net.oracle.freshness_duration),
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

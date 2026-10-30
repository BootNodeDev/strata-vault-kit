import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { oracle, send, type Connected } from "./clients.js"
import { REPO_ROOT } from "./deployment.js"
import { outcome } from "./refused.js"

export interface NavInput {
	nav_per_share: bigint
	expires_at: bigint
	proof_hash: Buffer
	proof_uri: string
}

/** The latest expiry a u64 holds: the oracle cuts it to its own window. */
const NO_EXPIRY = (1n << 64n) - 1n

const SAMPLE_PROOF = join(REPO_ROOT, "docs", "evidence", "sample-valuation.md")

// The release attests against the tag's copy; local runs use main's.
export const SAMPLE_PROOF_URI =
	process.env["PROOF_URI"] ??
	"https://raw.githubusercontent.com/BootNodeDev/strata-vault-kit/main/docs/evidence/sample-valuation.md"

export function navInput(nav: bigint): NavInput {
	return {
		nav_per_share: nav,
		expires_at: NO_EXPIRY,
		proof_hash: createHash("sha256")
			.update(readFileSync(SAMPLE_PROOF))
			.digest(),
		proof_uri: SAMPLE_PROOF_URI,
	}
}

// The cooldown is ledger time, so the second attestation of a run waits it out.
export async function attest(c: Connected, nav: bigint): Promise<void> {
	const attester = c.keys.attester
	const client = oracle(c, attester)
	const deadline = Date.now() + (c.net.oracle.cooldown_secs + 60) * 1_000
	for (;;) {
		const tx = await client.attest({
			input: navInput(nav),
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

// Deposits need a valid feed: a lapsed report is posted again at its own value.
export async function freshFeed(c: Connected, fallback: bigint): Promise<void> {
	const reader = oracle(c, c.keys.outsider)
	if ((await reader.state()).result.tag !== "Stale") return
	const latest = await reader.latest()
	const stored = outcome(latest, reader)
	if (stored === "accepted") return attest(c, latest.result.nav_per_share)
	if (stored === "refused: NoRecord") return attest(c, fallback)
	throw new Error(stored)
}

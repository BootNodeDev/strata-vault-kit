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

// The local RPC occasionally loses a just-funded account for one lookup; the
// account is real (deploy already funded it), so this is worth one retry.
function isTransientAccountLookup(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith("Account not found")
}

// The cooldown is ledger time, so the second attestation of a run waits it out.
export async function attest(c: Connected, nav: bigint): Promise<void> {
	const attester = c.keys.attester
	const client = oracle(c, attester)
	const deadline = Date.now() + (c.net.oracle.cooldown_secs + 60) * 1_000
	for (;;) {
		let tx
		try {
			tx = await client.attest({
				input: navInput(nav),
				caller: attester.publicKey(),
			})
		} catch (error) {
			if (!isTransientAccountLookup(error) || Date.now() > deadline) throw error
			await sleep(2_000)
			continue
		}
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

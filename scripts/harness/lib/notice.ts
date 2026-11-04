import { setTimeout as sleep } from "node:timers/promises"

import { type Client as VaultClient } from "../../../app-lib/clients/async_vault/dist/index.js"
import { type Connected } from "./clients.js"
import { outcome } from "./refused.js"

// Ledger time decides the notice, so poll the contract rather than wait on the clock.
export async function waitForNotice(
	c: Connected,
	reader: VaultClient,
	epochId: bigint,
): Promise<void> {
	const deadline = Date.now() + (c.net.vault.notice_secs + 60) * 1000
	for (;;) {
		const tx = await reader.fulfill_epoch({ epoch_id: epochId })
		if (outcome(tx, reader) !== "refused: NoticeNotElapsed") return
		if (Date.now() > deadline) {
			throw new Error(`notice never elapsed for epoch ${epochId}`)
		}
		await sleep(2_000)
	}
}

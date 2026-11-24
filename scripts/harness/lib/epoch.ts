import { oracle, send, vault, type Connected } from "./clients.js"
import { waitForNotice } from "./notice.js"
import { attest } from "./oracle.js"

// The seed leaves requests in the open epoch on purpose. A scenario that needs
// it empty seals it and prices it at the standing valuation.
export async function priceOpenEpoch(c: Connected): Promise<void> {
	const { manager, outsider } = c.keys
	const reader = vault(c, outsider)
	const id = (await reader.current_epoch()).result
	const open = (await reader.get_epoch({ epoch_id: id })).result
	if (
		!open ||
		(open.total_deposited === 0n && open.total_shares_redeeming === 0n)
	)
		return
	await send(
		vault(c, manager).close_epoch({ caller: manager.publicKey() }),
		`close_epoch manager epoch ${id}`,
	)
	const standing = (await oracle(c, outsider).latest()).result.nav_per_share
	await attest(c, standing, `attest attester epoch ${id}`)
	await waitForNotice(c, reader, id)
	await send(
		reader.fulfill_epoch({ epoch_id: id }),
		`fulfill_epoch outsider epoch ${id}`,
	)
}

import { Keypair } from "@stellar/stellar-sdk"

import { connect, send, shareToken, vault } from "./lib/clients.js"
import {
	ensureAllowlist,
	ensureFunding,
	ensureTrustline,
} from "./lib/holders.js"
import { loadPeople, peopleFile } from "./lib/people.js"

const MIN_USDC = 10_000
const TOP_UP_USDC = 50_000

async function main(): Promise<void> {
	const c = connect()
	const people = loadPeople(c.net.name)
	if (Object.keys(people).length === 0) {
		throw new Error(`no people in ${peopleFile(c.net.name)}`)
	}
	const decimals = (await shareToken(c, c.keys.outsider).decimals()).result

	for (const [name, person] of Object.entries(people)) {
		const key = Keypair.fromSecret(person.secret)
		console.log(`${name} (${person.roles.join(", ")})`)
		await ensureTrustline(c, key, name)
		await ensureFunding(c, key, name, MIN_USDC, TOP_UP_USDC, decimals)
		await ensureAllowlist(c, key, name)
	}

	const reader = vault(c, c.keys.outsider)
	const wanted = c.keys.custodian.publicKey()
	if ((await reader.custodian()).result !== wanted) {
		await send(
			vault(c, c.keys.governance).set_custodian({
				custodian: wanted,
				caller: c.keys.governance.publicKey(),
			}),
		)
	}
	console.log(`vault custodian: ${wanted}`)
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})

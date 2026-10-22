import { relative } from "node:path"

import { ACCOUNT_NAMES } from "./lib/accounts.js"
import { PACKAGE_ROOT, REPO_ROOT } from "./lib/deployment.js"
import { ensureKeys } from "./lib/keys.js"
import { network } from "./lib/network.js"

function main(): void {
	const { file, accounts, created } = ensureKeys(network().name, PACKAGE_ROOT)
	console.log(
		`account keys in ${relative(REPO_ROOT, file)} (${created.length} new)`,
	)
	for (const name of ACCOUNT_NAMES) {
		const mark = created.includes(name) ? "  new" : ""
		console.log(`${name.padEnd(10)} ${accounts[name].publicKey()}${mark}`)
	}
}

try {
	main()
} catch (error: unknown) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}

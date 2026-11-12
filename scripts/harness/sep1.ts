import { writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

import { connect } from "./lib/clients.js"
import { PACKAGE_ROOT, REPO_ROOT } from "./lib/deployment.js"
import { readOperatorValues } from "./lib/sep1-operator.js"
import { readSep1Inputs } from "./lib/sep1-reads.js"
import { renderStellarToml } from "./lib/stellar-toml.js"

async function main(): Promise<void> {
	const operator = readOperatorValues(process.env)
	const c = connect()
	const inputs = await readSep1Inputs(c)
	const { toml, missing } = renderStellarToml(inputs, operator)

	const file = join(PACKAGE_ROOT, `stellar.${c.net.name}.toml`)
	writeFileSync(file, toml)
	console.log(`wrote ${relative(REPO_ROOT, file)}`)
	if (
		inputs.report !== undefined &&
		Number(inputs.report.expiresAt) * 1000 <= Date.now()
	) {
		const expiresAt = new Date(Number(inputs.report.expiresAt) * 1000)
		console.log(
			`warning: the latest report expired at ${expiresAt.toISOString()}`,
		)
	}
	for (const { field, reason } of missing) {
		console.log(`missing ${field}: ${reason}`)
	}
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	})
}

import { readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

import { connect } from "./lib/clients.js"
import { PACKAGE_ROOT, REPO_ROOT } from "./lib/deployment.js"
import { readSep1Inputs } from "./lib/sep1-reads.js"
import {
	parseOperatorValues,
	renderStellarToml,
	type OperatorValues,
} from "./lib/stellar-toml.js"

function operatorValues(): OperatorValues {
	const path = process.env["SEP1_OPERATOR"]
	if (path === undefined) return {}
	return parseOperatorValues(JSON.parse(readFileSync(path, "utf8")))
}

async function main(): Promise<void> {
	const c = connect()
	const inputs = await readSep1Inputs(c)
	const { toml, missing } = renderStellarToml(inputs, operatorValues())

	const file = join(PACKAGE_ROOT, `stellar.${c.net.name}.toml`)
	writeFileSync(file, toml)
	console.log(`wrote ${relative(REPO_ROOT, file)}`)
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

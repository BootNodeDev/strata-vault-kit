import { existsSync } from "node:fs"
import { basename } from "node:path"
import { pathToFileURL } from "node:url"

import { verifyFeed, wasmOf } from "./deploy.js"
import { deployContract } from "./lib/cli.js"
import { connect } from "./lib/clients.js"
import { REPO_ROOT, saveDeployment, withFeed } from "./lib/deployment.js"
import { sourceCommit, wasmHash } from "./lib/provenance.js"

// Adds a feed to a vault set deployed before the feed existed. It reads every
// other contract in the record; it deploys and writes nothing else.
async function main(): Promise<void> {
	const feedWasm = wasmOf("sep40_feed")
	if (!existsSync(feedWasm)) {
		throw new Error(
			"no wasm for sep40_feed; run `stellar contract build` first",
		)
	}
	const c = connect()
	if (c.deployment.contracts.sep40_feed !== undefined) {
		throw new Error("the deployment already has a sep40_feed")
	}
	console.log(`deploying the feed to ${c.net.name} (${c.net.rpcUrl})`)

	const id = await deployContract(c.net, feedWasm, c.keys.deployer, {
		vault: c.deployment.contracts.async_vault,
	})
	console.log("sep40_feed", id)

	const record = withFeed(
		c.deployment,
		id,
		wasmHash(feedWasm),
		sourceCommit(REPO_ROOT),
	)
	console.log(
		`feed built at ${record.feedCommit}${record.feedUncommittedChanges ? " with uncommitted changes" : ""}`,
	)
	await verifyFeed(c.net, c.keys, record, c.server)

	const kept = saveDeployment(record)
	if (kept !== undefined)
		console.log(`kept the previous record as ${basename(kept)}`)
	console.log(`wrote deployed.${c.net.name}.json`)
	if (c.net.name === "testnet") {
		console.log(
			"updated environments.toml [staging.contracts] and the README addresses: commit both, or the app keeps building against the previous contracts",
		)
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

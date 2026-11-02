import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { BindingGenerator } from "@stellar/stellar-sdk"

import { writeClient } from "../lib/clients.mjs"
import { stellarAssetGenerator } from "./lib/asset-client.js"
import { generateClient, rootSdkVersion } from "./lib/cli.js"
import {
	CONTRACT_NAMES,
	REPO_ROOT,
	type ContractName,
} from "./lib/deployment.js"

const wasmOf = (name: ContractName): string =>
	join(REPO_ROOT, "target", "wasm32v1-none", "release", `${name}.wasm`)

const clientDir = (name: ContractName): string =>
	join(REPO_ROOT, "app-lib", "clients", name)

async function main(): Promise<void> {
	const missing = CONTRACT_NAMES.filter((name) => !existsSync(wasmOf(name)))
	if (missing.length > 0) {
		throw new Error(
			`missing wasm for ${missing.join(", ")}; run \`stellar contract build\` first`,
		)
	}

	// The harness imports each client's `dist/`, compiled from the CLI's
	// bindings. The app imports `src/`, written by the SDK's generator as the
	// app's own build does; the two type an empty `Option` differently.
	const sdkVersion = rootSdkVersion()
	for (const name of CONTRACT_NAMES) {
		await generateClient(wasmOf(name), clientDir(name), sdkVersion)
		const generator = BindingGenerator.fromWasm(readFileSync(wasmOf(name)))
		writeClient(REPO_ROOT, name, generator.generate({ contractName: name }))
	}
	const asset = await stellarAssetGenerator()
	writeClient(REPO_ROOT, "asset", asset.generate({ contractName: "asset" }))
	console.log("clients generated")
}

main().catch((err: unknown) => {
	console.error(err)
	process.exit(1)
})

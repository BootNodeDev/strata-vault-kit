import { existsSync } from "node:fs"
import { join } from "node:path"

import { stellarAssetGenerator } from "./lib/asset-client.js"
import { generateClient, rootSdkVersion, wasmGenerator } from "./lib/cli.js"
import {
	CONTRACT_NAMES,
	EXAMPLE_NAMES,
	REPO_ROOT,
	type ContractName,
	type ExampleName,
} from "./lib/deployment.js"

const NAMES = [...CONTRACT_NAMES, ...EXAMPLE_NAMES]

const wasmOf = (name: ContractName | ExampleName): string =>
	join(REPO_ROOT, "target", "wasm32v1-none", "release", `${name}.wasm`)

const clientDir = (name: ContractName | ExampleName | "asset"): string =>
	join(REPO_ROOT, "app-lib", "clients", name)

async function main(): Promise<void> {
	const missing = NAMES.filter((name) => !existsSync(wasmOf(name)))
	if (missing.length > 0) {
		throw new Error(
			`missing wasm for ${missing.join(", ")}; run \`stellar contract build\` first`,
		)
	}

	const sdkVersion = rootSdkVersion()
	for (const name of NAMES) {
		await generateClient(
			clientDir(name),
			wasmGenerator(wasmOf(name)),
			sdkVersion,
		)
	}
	await generateClient(
		clientDir("asset"),
		await stellarAssetGenerator(),
		sdkVersion,
	)
	console.log("clients generated")
}

main().catch((err: unknown) => {
	console.error(err)
	process.exit(1)
})

import { existsSync } from "node:fs"
import { join } from "node:path"
import { generateClient } from "./lib/cli.js"
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

	for (const name of CONTRACT_NAMES) {
		await generateClient(wasmOf(name), clientDir(name))
	}
	console.log("clients generated")
}

main().catch((err: unknown) => {
	console.error(err)
	process.exit(1)
})

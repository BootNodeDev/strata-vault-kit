import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { missingClients } from "./lib/clients.mjs"

// Runs as the root `pretest` hook. The tests import the generated contract
// clients, so without them every test file fails on a module it cannot resolve.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const missing = missingClients(repoRoot)
if (missing.length > 0) {
	console.error(
		[
			"",
			"Cannot test — the generated contract clients are missing:",
			"",
			...missing.map((name) => `  - app-lib/clients/${name}`),
			"",
			"Build the contracts and generate the clients first:",
			"",
			"  stellar contract build && npm run build:clients",
			"",
		].join("\n"),
	)
	process.exit(1)
}

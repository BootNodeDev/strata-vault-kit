import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { missingClients } from "./lib/clients.mjs"

// Runs before the root `test` and `typecheck`, which import the generated clients.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const missing = missingClients(repoRoot)
if (missing.length > 0) {
	console.error(
		[
			"",
			"The generated contract clients are missing:",
			"",
			...missing.map((path) => `  - ${path}`),
			"",
			"Build the contracts and generate the clients first:",
			"",
			"  stellar contract build && npm run build:clients",
			"",
		].join("\n"),
	)
	process.exit(1)
}

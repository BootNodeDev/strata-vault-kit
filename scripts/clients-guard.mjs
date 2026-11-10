import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { missingClients, missingClientsMessage } from "./lib/clients.mjs"

// Runs before the root `test`, and with `--compiled` before `typecheck`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const missing = missingClients(repoRoot, {
	compiled: process.argv.includes("--compiled"),
})
if (missing.length > 0) {
	console.error(missingClientsMessage(missing))
	process.exit(1)
}

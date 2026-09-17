#!/usr/bin/env node
// Emits the deployed addresses as a module the app can import, so a build that
// cannot reach the network still knows which contracts it talks to.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const source = resolve(repoRoot, "environments.toml")
const target = resolve(repoRoot, "app/src/config/addresses.ts")

// Only deployed environments declare their addresses here; a local one gets
// them when it deploys, which is after this runs.
const environment = process.env.ADDRESSES_ENV ?? "staging"

const toml = readFileSync(source, "utf8")
const section = toml.split(`[${environment}.contracts]`)[1]?.split("\n[")[0]
if (section === undefined) {
	throw new Error(
		`environments.toml has no [${environment}.contracts] section. ` +
			`Set ADDRESSES_ENV to an environment it declares.`,
	)
}

const addresses = [
	...section.matchAll(/^(\w+)\s*=\s*\{[^}]*id\s*=\s*"(C\w+)"/gm),
]
if (addresses.length === 0) {
	throw new Error(
		`[${environment}.contracts] declares no deployed addresses. ` +
			`Deploy first, or set ADDRESSES_ENV to an environment that has them.`,
	)
}

const entries = addresses
	.map(([, name, id]) => `\t${name}: "${id}",`)
	.join("\n")

mkdirSync(dirname(target), { recursive: true })
writeFileSync(
	target,
	`// Generated from environments.toml. Do not edit.\nexport const addresses = {\n${entries}\n} as const\n`,
)

console.log(`addresses.ts: ${addresses.length} from [${environment}.contracts]`)

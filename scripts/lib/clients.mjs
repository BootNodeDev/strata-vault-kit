import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

const crateNames = (dir) =>
	existsSync(dir)
		? readdirSync(dir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name.replaceAll("-", "_"))
		: []

// Examples (`examples/`) are third-party contracts, not kit crates, but they
// still need a generated client.
const crateClients = (root) =>
	[
		...crateNames(join(root, "contracts")),
		...crateNames(join(root, "examples")),
	].sort()

// Tests import `src/`; the type check also needs each contract client's `dist/`.
export const missingClients = (root, { compiled = false } = {}) =>
	[
		...crateClients(root).flatMap((name) => [
			`app-lib/clients/${name}/src/index.ts`,
			...(compiled ? [`app-lib/clients/${name}/dist/index.js`] : []),
		]),
		"app-lib/clients/asset/src/index.ts",
	].filter((path) => !existsSync(join(root, path)))

export const missingClientsMessage = (missing) =>
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
	].join("\n")

export const writeClient = (dir, files) => {
	const name = basename(dir)
	mkdirSync(join(dir, "src"), { recursive: true })
	const sources = {
		"src/index.ts": files.index,
		"src/types.ts": files.types,
		"src/client.ts": files.client,
		"package.json": files.packageJson.replace(
			/"name": "[^"]+"/,
			`"name": "${name}"`,
		),
		"tsconfig.json": files.tsConfig,
	}
	for (const [path, content] of Object.entries(sources)) {
		writeFileSync(join(dir, path), content)
	}
}

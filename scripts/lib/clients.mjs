import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const clientDir = (root, name) => join(root, "app-lib", "clients", name)

// One client per contract crate, plus the Stellar Asset Contract the vault holds.
const expectedClients = (root) => [
	...readdirSync(join(root, "contracts"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name.replaceAll("-", "_"))
		.sort(),
	"asset",
]

export const missingClients = (root) =>
	expectedClients(root).filter(
		(name) => !existsSync(join(clientDir(root, name), "src", "index.ts")),
	)

// Writes the SDK generator's bindings where `app-lib/contracts.ts` imports them.
export const writeClient = (root, name, files) => {
	const dir = clientDir(root, name)
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

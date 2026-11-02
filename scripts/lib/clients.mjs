import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

const crateClients = (root) =>
	readdirSync(join(root, "contracts"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name.replaceAll("-", "_"))
		.sort()

// The app imports each client's `src/`, the harness a contract client's `dist/`.
export const missingClients = (root) =>
	[
		...crateClients(root).flatMap((name) => [
			`app-lib/clients/${name}/src/index.ts`,
			`app-lib/clients/${name}/dist/index.js`,
		]),
		"app-lib/clients/asset/src/index.ts",
	].filter((path) => !existsSync(join(root, path)))

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

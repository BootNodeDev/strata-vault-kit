import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import { missingClients, writeClient } from "./clients.mjs"

const repo = (contracts, clients, { unbuilt = [] } = {}) => {
	const root = mkdtempSync(join(tmpdir(), "clients-"))
	for (const name of contracts) {
		mkdirSync(join(root, "contracts", name), { recursive: true })
	}
	for (const name of clients) {
		const client = join(root, "app-lib", "clients", name)
		mkdirSync(join(client, "src"), { recursive: true })
		writeFileSync(join(client, "src", "index.ts"), "export {}\n")
		if (unbuilt.includes(name)) continue
		mkdirSync(join(client, "dist"), { recursive: true })
		writeFileSync(join(client, "dist", "index.js"), "export {}\n")
	}
	return root
}

const source = (name) => `app-lib/clients/${name}/src/index.ts`
const compiled = (name) => `app-lib/clients/${name}/dist/index.js`

describe("missingClients", () => {
	it("finds none when every contract and the asset have a client", () => {
		const root = repo(
			["async-vault", "nav-oracle"],
			["async_vault", "nav_oracle", "asset"],
		)

		expect(missingClients(root)).toEqual([])
	})

	it("names each contract without a client, in its underscored form", () => {
		const root = repo(["async-vault", "nav-oracle"], ["async_vault", "asset"])

		expect(missingClients(root)).toEqual([
			source("nav_oracle"),
			compiled("nav_oracle"),
		])
	})

	it("needs a client for the asset, which has no crate", () => {
		const root = repo(["async-vault"], ["async_vault"])

		expect(missingClients(root)).toEqual([source("asset")])
	})

	it("needs each contract client compiled, since the harness imports its dist", () => {
		const root = repo(["async-vault"], ["async_vault", "asset"], {
			unbuilt: ["async_vault", "asset"],
		})

		expect(missingClients(root)).toEqual([compiled("async_vault")])
	})

	it("names them all when the clients folder is empty", () => {
		const root = repo(["async-vault", "share-token"], [])
		mkdirSync(join(root, "app-lib", "clients"), { recursive: true })

		expect(missingClients(root)).toEqual([
			source("async_vault"),
			compiled("async_vault"),
			source("share_token"),
			compiled("share_token"),
			source("asset"),
		])
	})
})

describe("writeClient", () => {
	const files = {
		index: "export * from './client.js'\n",
		types: "export {}\n",
		client: "export class Client {}\n",
		packageJson: '{\n  "name": "generated-name",\n  "version": "0.0.1"\n}\n',
		tsConfig: "{}\n",
	}

	it("writes the generated sources where the app imports them", () => {
		const root = repo(["async-vault"], [])

		writeClient(join(root, "app-lib", "clients", "async_vault"), files)

		const src = join(root, "app-lib", "clients", "async_vault", "src")
		expect(readFileSync(join(src, "index.ts"), "utf8")).toBe(files.index)
		expect(readFileSync(join(src, "types.ts"), "utf8")).toBe(files.types)
		expect(readFileSync(join(src, "client.ts"), "utf8")).toBe(files.client)
	})

	it("names the package after the client", () => {
		const root = repo([], [])

		writeClient(join(root, "app-lib", "clients", "nav_oracle"), files)

		const pkg = JSON.parse(
			readFileSync(
				join(root, "app-lib", "clients", "nav_oracle", "package.json"),
				"utf8",
			),
		)
		expect(pkg).toEqual({ name: "nav_oracle", version: "0.0.1" })
	})
})

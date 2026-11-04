import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import {
	missingClients,
	missingClientsMessage,
	writeClient,
} from "./clients.mjs"

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
		expect(missingClients(root, { compiled: true })).toEqual([])
	})

	it("names each contract without a client, in its underscored form", () => {
		const root = repo(["async-vault", "nav-oracle"], ["async_vault", "asset"])

		expect(missingClients(root)).toEqual([source("nav_oracle")])
	})

	it("needs a client for the asset, which has no crate", () => {
		const root = repo(["async-vault"], ["async_vault"])

		expect(missingClients(root)).toEqual([source("asset")])
	})

	it("passes the test guard with sources alone, since the tests import src", () => {
		const root = repo(["async-vault"], ["async_vault", "asset"], {
			unbuilt: ["async_vault", "asset"],
		})

		expect(missingClients(root)).toEqual([])
	})

	it("fails the typecheck guard without each contract client's dist, which the harness imports", () => {
		const root = repo(["async-vault"], ["async_vault", "asset"], {
			unbuilt: ["async_vault", "asset"],
		})

		const missing = missingClients(root, { compiled: true })

		expect(missing).toEqual([compiled("async_vault")])
		expect(missingClientsMessage(missing)).toContain("npm run build:clients")
	})

	it("names them all when the clients folder is empty", () => {
		const root = repo(["async-vault", "share-token"], [])
		mkdirSync(join(root, "app-lib", "clients"), { recursive: true })

		expect(missingClients(root, { compiled: true })).toEqual([
			source("async_vault"),
			compiled("async_vault"),
			source("share_token"),
			compiled("share_token"),
			source("asset"),
		])
	})
})

describe("missingClientsMessage", () => {
	it("lists each missing path and the command that generates them", () => {
		const message = missingClientsMessage([source("asset")])

		expect(message).toContain(source("asset"))
		expect(message).toContain("stellar contract build && npm run build:clients")
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

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import { missingClients, writeClient } from "./clients.mjs"

const repo = (contracts, clients) => {
	const root = mkdtempSync(join(tmpdir(), "clients-"))
	for (const name of contracts) {
		mkdirSync(join(root, "contracts", name), { recursive: true })
	}
	for (const name of clients) {
		const src = join(root, "app-lib", "clients", name, "src")
		mkdirSync(src, { recursive: true })
		writeFileSync(join(src, "index.ts"), "export {}\n")
	}
	return root
}

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

		expect(missingClients(root)).toEqual(["nav_oracle"])
	})

	it("needs a client for the asset, which has no crate", () => {
		const root = repo(["async-vault"], ["async_vault"])

		expect(missingClients(root)).toEqual(["asset"])
	})

	it("names them all when the clients folder is empty", () => {
		const root = repo(["async-vault", "share-token"], [])
		mkdirSync(join(root, "app-lib", "clients"), { recursive: true })

		expect(missingClients(root)).toEqual([
			"async_vault",
			"share_token",
			"asset",
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

		writeClient(root, "async_vault", files)

		const src = join(root, "app-lib", "clients", "async_vault", "src")
		expect(readFileSync(join(src, "index.ts"), "utf8")).toBe(files.index)
		expect(readFileSync(join(src, "types.ts"), "utf8")).toBe(files.types)
		expect(readFileSync(join(src, "client.ts"), "utf8")).toBe(files.client)
		expect(missingClients(root)).toEqual(["asset"])
	})

	it("names the package after the client", () => {
		const root = repo([], [])

		writeClient(root, "nav_oracle", files)

		const pkg = JSON.parse(
			readFileSync(
				join(root, "app-lib", "clients", "nav_oracle", "package.json"),
				"utf8",
			),
		)
		expect(pkg).toEqual({ name: "nav_oracle", version: "0.0.1" })
	})
})

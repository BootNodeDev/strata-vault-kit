#!/usr/bin/env node
// Generates a typed client per deployed contract from its on-chain spec, so a
// build needs Node and RPC access only, with no cargo or Stellar CLI.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { BindingGenerator, rpc } from "@stellar/stellar-sdk"
import {
	contractIds,
	networkOf,
	selectedEnvironment,
} from "./lib/environments.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const toml = readFileSync(resolve(repoRoot, "environments.toml"), "utf8")
const environment = selectedEnvironment(process.env)
const contracts = contractIds(toml, environment)
const { rpcUrl, networkPassphrase, allowHttp } = networkOf(toml, environment)
const server = new rpc.Server(rpcUrl, { allowHttp })

const generate = async ({ name, id }) => {
	const generator = await BindingGenerator.fromContractId(id, server)
	const files = generator.generate({
		contractName: name,
		contractAddress: id,
		rpcUrl,
		networkPassphrase,
	})
	const dir = resolve(repoRoot, "app-lib/clients", name)
	mkdirSync(resolve(dir, "src"), { recursive: true })
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
		writeFileSync(resolve(dir, path), content)
	}
}

await Promise.all(contracts.map(generate))

console.log(`clients: ${contracts.length} from [${environment}.contracts]`)

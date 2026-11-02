import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	Address,
	Asset,
	Keypair,
	Networks,
	type rpc,
	type xdr,
} from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { stellarAssetGenerator } from "./asset-client.js"
import {
	ensureAssetContract,
	pinClientSdk,
	rootSdkVersion,
	writeClientSources,
} from "./cli.js"
import { REPO_ROOT } from "./deployment.js"
import { type Network } from "./network.js"

describe("ensureAssetContract", () => {
	it("returns the asset contract already on the network", async () => {
		const net = { passphrase: Networks.STANDALONE } as Network
		const issuer = Keypair.random()
		const asset = new Asset("USDC", issuer.publicKey())
		const id = asset.contractId(net.passphrase)
		const server = {
			getLedgerEntries(key: xdr.LedgerKey) {
				const contract = Address.fromScAddress(
					key.contractData().contract(),
				).toString()
				return Promise.resolve({
					entries: contract === id ? [{}] : [],
					latestLedger: 1,
				})
			},
		} as unknown as rpc.Server

		expect(await ensureAssetContract(net, server, asset, issuer)).toBe(id)
	})
})

describe("pinClientSdk", () => {
	it("pins a client's stellar-sdk dependency to the given version", () => {
		const pkg = {
			name: "example",
			dependencies: { "@stellar/stellar-sdk": "^14.5.0", buffer: "6.0.3" },
		}

		expect(pinClientSdk(pkg, "16.4.1")).toEqual({
			name: "example",
			dependencies: { "@stellar/stellar-sdk": "16.4.1", buffer: "6.0.3" },
		})
	})

	it("leaves a package without the dependency unchanged", () => {
		const pkg = { name: "example", dependencies: { buffer: "6.0.3" } }

		expect(pinClientSdk(pkg, "16.4.1")).toBe(pkg)
	})

	it("pins to the version the root package.json overrides", () => {
		const version = rootSdkVersion()
		const pkg = { dependencies: { "@stellar/stellar-sdk": "^14.5.0" } }

		expect(pinClientSdk(pkg, version)).toEqual({
			dependencies: { "@stellar/stellar-sdk": version },
		})
	})
})

describe("rootSdkVersion", () => {
	it("reads the stellar-sdk override from the root package.json", () => {
		const rootPkg = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
		) as { overrides?: Record<string, string> }

		expect(rootSdkVersion()).toBe(rootPkg.overrides?.["@stellar/stellar-sdk"])
	})
})

describe("writeClientSources", () => {
	it("writes the SDK's bindings named after the client, with its stellar-sdk pinned", async () => {
		const outDir = join(mkdtempSync(join(tmpdir(), "client-")), "asset")

		writeClientSources(outDir, await stellarAssetGenerator(), "16.4.1")

		const pkg = JSON.parse(
			readFileSync(join(outDir, "package.json"), "utf8"),
		) as { name: string; dependencies: Record<string, string> }
		expect(pkg.name).toBe("asset")
		expect(pkg.dependencies["@stellar/stellar-sdk"]).toBe("16.4.1")
		for (const file of ["index.ts", "types.ts", "client.ts"]) {
			expect(existsSync(join(outDir, "src", file))).toBe(true)
		}
	})
})

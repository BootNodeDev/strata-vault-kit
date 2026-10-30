import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Keypair } from "@stellar/stellar-sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ACCOUNT_NAMES, type Accounts } from "./accounts.js"
import {
	clearIncomplete,
	deploymentFile,
	incompleteFile,
	publicKeysOf,
	refuseIncomplete,
	saveDeployment,
	writeIncomplete,
	type Deployment,
	type IncompleteDeployment,
} from "./deployment.js"

let dir = ""

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "harness-records-"))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

const record = (deployedAt: string): Deployment => ({
	network: "local",
	deployedAt,
	commit: "0123456789abcdef0123456789abcdef01234567",
	uncommittedChanges: false,
	ledger: 1,
	asset: { code: "USDC", issuer: "G", contract: "C" },
	contracts: {
		compliance: "C1",
		identity_verifier: "C2",
		share_token: "C3",
		nav_oracle: "C4",
		async_vault: "C5",
	},
	wasmHashes: {
		compliance: "H1",
		identity_verifier: "H2",
		share_token: "H3",
		nav_oracle: "H4",
		async_vault: "H5",
	},
	accounts: {} as Deployment["accounts"],
})

const deployedAtOf = (file: string): unknown =>
	(JSON.parse(readFileSync(file, "utf8")) as { deployedAt?: unknown })
		.deployedAt

describe("saveDeployment", () => {
	it("keeps nothing aside on the first deploy", () => {
		expect(
			saveDeployment(record("2026-10-01T12:30:45.678Z"), dir),
		).toBeUndefined()
		expect(readdirSync(dir)).toEqual(["deployed.local.json"])
	})

	it("keeps the previous record under the time it was deployed", () => {
		saveDeployment(record("2026-10-01T12:30:45.678Z"), dir)

		const kept = saveDeployment(record("2026-10-22T09:00:00.000Z"), dir)

		expect(kept).toBe(join(dir, "deployed.local.2026-10-01T12-30-45-678Z.json"))
		expect(deployedAtOf(kept ?? "")).toBe("2026-10-01T12:30:45.678Z")
		expect(deployedAtOf(deploymentFile("local", dir))).toBe(
			"2026-10-22T09:00:00.000Z",
		)
	})

	it("never overwrites a record it kept before", () => {
		const twice = "2026-10-01T12:30:45.678Z"
		saveDeployment(record(twice), dir)
		saveDeployment(record(twice), dir)

		const kept = saveDeployment(record("2026-10-22T09:00:00.000Z"), dir)

		expect(kept).toBe(
			join(dir, "deployed.local.2026-10-01T12-30-45-678Z-1.json"),
		)
		expect(readdirSync(dir).sort()).toEqual([
			"deployed.local.2026-10-01T12-30-45-678Z-1.json",
			"deployed.local.2026-10-01T12-30-45-678Z.json",
			"deployed.local.json",
		])
	})

	it.each(["{}\n", "not json\n"])(
		"names a record without a readable time after the file's time: %j",
		(content) => {
			const file = deploymentFile("local", dir)
			writeFileSync(file, content)
			const modified = new Date("2026-03-04T05:06:07.000Z")
			utimesSync(file, modified, modified)

			const kept = saveDeployment(record("2026-10-22T09:00:00.000Z"), dir)

			expect(kept).toBe(
				join(dir, "deployed.local.2026-03-04T05-06-07-000Z.json"),
			)
			expect(readFileSync(kept ?? "", "utf8")).toBe(content)
		},
	)
})

const progress = (): IncompleteDeployment => ({
	network: "local",
	startedAt: "2026-10-28T12:00:00.000Z",
	complete: false,
	asset: { code: "USDC", issuer: "G", contract: "C" },
	contracts: { compliance: "C1", identity_verifier: "C2" },
})

describe("writeIncomplete", () => {
	it("keeps the contracts of an unfinished deploy in their own file", () => {
		writeIncomplete(progress(), dir)

		expect(
			JSON.parse(readFileSync(incompleteFile("local", dir), "utf8")),
		).toEqual(progress())
		expect(readdirSync(dir)).toEqual(["deployed.local.incomplete.json"])
	})
})

describe("refuseIncomplete", () => {
	it("refuses a deploy while an unfinished deploy's file is there", () => {
		writeIncomplete(progress(), dir)

		expect(() => refuseIncomplete("local", dir)).toThrow(
			/deployed\.local\.incomplete\.json/,
		)
		expect(() => refuseIncomplete("local", dir)).toThrow(
			"Move or delete that file",
		)
	})

	it("lets a deploy run once the file is gone", () => {
		writeIncomplete(progress(), dir)

		clearIncomplete("local", dir)

		expect(() => refuseIncomplete("local", dir)).not.toThrow()
		expect(() => clearIncomplete("local", dir)).not.toThrow()
	})
})

describe("publicKeysOf", () => {
	it("records each account's public key and no secret key", () => {
		const accounts = Object.fromEntries(
			ACCOUNT_NAMES.map((name) => [name, Keypair.random()]),
		) as Accounts
		saveDeployment(
			{
				...record("2026-10-01T12:30:45.678Z"),
				accounts: publicKeysOf(accounts),
			},
			dir,
		)
		const text = readFileSync(deploymentFile("local", dir), "utf8")
		for (const name of ACCOUNT_NAMES) {
			expect(text).toContain(accounts[name].publicKey())
			expect(text).not.toContain(accounts[name].secret())
		}
	})
})

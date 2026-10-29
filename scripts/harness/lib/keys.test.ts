import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Keypair, StrKey } from "@stellar/stellar-sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ACCOUNT_NAMES, type AccountName, type Accounts } from "./accounts.js"
import { publicKeysOf, type Deployment } from "./deployment.js"
import { ensureKeys, keysFile, keysFor } from "./keys.js"

const VARIABLES = [
	"DEPLOYER_SECRET",
	"GOVERNANCE_SECRET",
	"MANAGER_SECRET",
	"TREASURY_SECRET",
	"GUARDIAN_SECRET",
	"COMPLIANCE_SECRET",
	"ATTESTER_SECRET",
	"CUSTODIAN_SECRET",
	"ISSUER_SECRET",
	"HOLDER_1_SECRET",
	"HOLDER_2_SECRET",
	"HOLDER_3_SECRET",
	"OUTSIDER_SECRET",
]

let dir = ""

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "harness-keys-"))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

const linesOf = (file: string): string[] =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line !== "")

function errorOf(run: () => unknown): string {
	try {
		run()
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
	throw new Error("expected an error")
}

describe("ensureKeys", () => {
	it("creates a key for every account when there is no file", () => {
		const { file, accounts, created } = ensureKeys("local", dir)

		expect(file).toBe(join(dir, ".env.keys.local"))
		const [header, ...entries] = linesOf(file)
		expect(header).toMatch(/^# .*secret.*git.*back/i)
		expect(entries.map((line) => line.split("=")[0])).toEqual(VARIABLES)
		ACCOUNT_NAMES.forEach((name, i) => {
			const secret = entries[i]?.split("=")[1] ?? ""
			expect(StrKey.isValidEd25519SecretSeed(secret)).toBe(true)
			expect(accounts[name].secret()).toBe(secret)
		})
		expect(created).toEqual([...ACCOUNT_NAMES])
	})

	it("completes a partial file without changing the keys already in it", () => {
		const file = keysFile("local", dir)
		const chosen = Keypair.random()
		const deployer = Keypair.random()
		writeFileSync(
			file,
			`HOLDER_1_SECRET=${chosen.secret()}\nDEPLOYER_SECRET=${deployer.secret()}\n`,
		)

		const { accounts, created } = ensureKeys("local", dir)

		expect(accounts["holder-1"].publicKey()).toBe(chosen.publicKey())
		expect(accounts.deployer.publicKey()).toBe(deployer.publicKey())
		expect(created).toEqual(
			ACCOUNT_NAMES.filter(
				(name) => name !== "holder-1" && name !== "deployer",
			),
		)
		const lines = linesOf(file)
		expect(lines).toHaveLength(1 + ACCOUNT_NAMES.length)
		expect(lines).toContain(`HOLDER_1_SECRET=${chosen.secret()}`)
		expect(lines).toContain(`DEPLOYER_SECRET=${deployer.secret()}`)
	})

	it("reuses every key on the next run", () => {
		const first = ensureKeys("local", dir)
		const written = readFileSync(first.file, "utf8")

		const second = ensureKeys("local", dir)

		expect(second.created).toEqual([])
		for (const name of ACCOUNT_NAMES) {
			expect(second.accounts[name].publicKey()).toBe(
				first.accounts[name].publicKey(),
			)
		}
		expect(readFileSync(second.file, "utf8")).toBe(written)
	})

	it("refuses an invalid secret, naming its line but not its value", () => {
		const file = keysFile("local", dir)
		const original = "# my note\nGOVERNANCE_SECRET=SNOTAKEY\n"
		writeFileSync(file, original)

		const message = errorOf(() => ensureKeys("local", dir))

		expect(message).toBe(
			`${file}:2: GOVERNANCE_SECRET is not a valid Stellar secret key`,
		)
		expect(message).not.toContain("SNOTAKEY")
		expect(readFileSync(file, "utf8")).toBe(original)
	})

	it("refuses an account whose key is set twice", () => {
		const file = keysFile("local", dir)
		writeFileSync(
			file,
			`DEPLOYER_SECRET=${Keypair.random().secret()}\nDEPLOYER_SECRET=${Keypair.random().secret()}\n`,
		)

		expect(errorOf(() => ensureKeys("local", dir))).toBe(
			`${file}:2: DEPLOYER_SECRET is set twice`,
		)
	})

	it("refuses one key for two accounts", () => {
		const file = keysFile("local", dir)
		const shared = Keypair.random().secret()
		writeFileSync(
			file,
			`DEPLOYER_SECRET=${shared}\nHOLDER_1_SECRET=${shared}\n`,
		)

		const message = errorOf(() => ensureKeys("local", dir))

		expect(message).toBe(
			`${file}:2: HOLDER_1_SECRET has the same key as DEPLOYER_SECRET`,
		)
		expect(message).not.toContain(shared)
	})

	it("leaves the file readable by its owner only", () => {
		const created = ensureKeys("local", dir).file
		expect(statSync(created).mode & 0o777).toBe(0o600)

		const handMade = keysFile("testnet", dir)
		writeFileSync(handMade, "")
		chmodSync(handMade, 0o644)
		ensureKeys("testnet", dir)
		expect(statSync(handMade).mode & 0o777).toBe(0o600)
	})

	it("keeps lines it does not recognise", () => {
		const file = keysFile("local", dir)
		const own = ["# my note", "HOLDER_4_SECRET=whatever", "RPC=http://x"]
		writeFileSync(file, `${own.join("\n")}\n`)

		ensureKeys("local", dir)
		ensureKeys("local", dir)

		const lines = linesOf(file)
		expect(lines).toHaveLength(1 + ACCOUNT_NAMES.length + own.length)
		expect(lines.slice(-own.length)).toEqual(own)
	})
})

describe("keysFor", () => {
	const recordOf = (
		accounts: Deployment["accounts"],
	): Pick<Deployment, "network" | "accounts"> => ({
		network: "local",
		accounts,
	})

	// Names the accounts whose key is not the file's, so a failure prints no secret.
	const notFromFile = (file: string, keys: Accounts): string[] => {
		const written = new Set(linesOf(file))
		return ACCOUNT_NAMES.filter(
			(name, i) => !written.has(`${VARIABLES[i]}=${keys[name].secret()}`),
		)
	}

	it("signs with the key file's key for each account the record names", () => {
		const { file, accounts } = ensureKeys("local", dir)

		const keys = keysFor(recordOf(publicKeysOf(accounts)), dir)

		expect(notFromFile(file, keys)).toEqual([])
	})

	it("reads a record written while records still held secret keys", () => {
		const { file, accounts } = ensureKeys("local", dir)
		const withSecrets = Object.fromEntries(
			ACCOUNT_NAMES.map((name) => [
				name,
				{ public: accounts[name].publicKey(), secret: accounts[name].secret() },
			]),
		) as Record<AccountName, { public: string; secret: string }>

		const keys = keysFor(recordOf(withSecrets), dir)

		expect(notFromFile(file, keys)).toEqual([])
	})

	it("takes an account the record does not name from the key file", () => {
		const { accounts } = ensureKeys("local", dir)
		const named: Partial<Deployment["accounts"]> = publicKeysOf(accounts)
		delete named.outsider

		const keys = keysFor(recordOf(named as Deployment["accounts"]), dir)

		expect(keys.outsider.publicKey()).toBe(accounts.outsider.publicKey())
	})

	it("stops when there is no key file, and creates none", () => {
		const accounts = Object.fromEntries(
			ACCOUNT_NAMES.map((name) => [name, Keypair.random()]),
		) as Accounts

		const message = errorOf(() =>
			keysFor(recordOf(publicKeysOf(accounts)), dir),
		)

		expect(message).toContain(keysFile("local", dir))
		expect(message).toContain("Restore it from your backup")
		expect(existsSync(keysFile("local", dir))).toBe(false)
	})

	it("stops when the key file has no line for an account", () => {
		const { file, accounts } = ensureKeys("local", dir)
		const without = `${linesOf(file)
			.filter((line) => !line.startsWith("HOLDER_2_SECRET="))
			.join("\n")}\n`
		writeFileSync(file, without)

		const message = errorOf(() =>
			keysFor(recordOf(publicKeysOf(accounts)), dir),
		)

		expect(message).toContain("has no HOLDER_2_SECRET")
		expect(readFileSync(file, "utf8")).toBe(without)
	})

	it("stops when a key is not the one the deployment was made with", () => {
		const { accounts } = ensureKeys("local", dir)
		const other = Keypair.random().publicKey()
		const record = recordOf({
			...publicKeysOf(accounts),
			"holder-1": { public: other },
		})

		const message = errorOf(() => keysFor(record, dir))

		expect(message).toContain("HOLDER_1_SECRET")
		expect(message).toContain(other)
		expect(message).toContain(accounts["holder-1"].publicKey())
		expect(message).not.toContain(accounts["holder-1"].secret())
	})
})

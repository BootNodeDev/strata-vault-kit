import {
	chmodSync,
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { Keypair, StrKey } from "@stellar/stellar-sdk"

import { ACCOUNT_NAMES, type AccountName, type Accounts } from "./accounts.js"
import { type Deployment } from "./deployment.js"
import { type NetworkName } from "./network.js"

export interface AccountKeys {
	file: string
	accounts: Accounts
	created: AccountName[]
}

export function keysFile(network: NetworkName, dir: string): string {
	return join(dir, `.env.keys.${network}`)
}

const variableOf = (name: AccountName): string =>
	`${name.toUpperCase().replaceAll("-", "_")}_SECRET`

const headerOf = (network: NetworkName): string =>
	`# Secret keys of the harness accounts on ${network}. Keep this file out of git and back it up.`

function parse(
	text: string,
	file: string,
	header: string,
): { secrets: Map<AccountName, string>; others: string[] } {
	const known = new Map(ACCOUNT_NAMES.map((name) => [variableOf(name), name]))
	const secrets = new Map<AccountName, string>()
	const owners = new Map<string, AccountName>()
	const others: string[] = []
	for (const [index, raw] of text.split(/\r?\n/).entries()) {
		const line = raw.trim()
		if (line === "" || line === header) continue
		const at = line.indexOf("=")
		const name = at === -1 ? undefined : known.get(line.slice(0, at).trim())
		if (name === undefined) {
			others.push(raw)
			continue
		}
		const where = `${file}:${index + 1}: ${variableOf(name)}`
		if (secrets.has(name)) throw new Error(`${where} is set twice`)
		const secret = line.slice(at + 1).trim()
		if (!StrKey.isValidEd25519SecretSeed(secret)) {
			throw new Error(`${where} is not a valid Stellar secret key`)
		}
		const owner = owners.get(secret)
		if (owner !== undefined) {
			throw new Error(`${where} has the same key as ${variableOf(owner)}`)
		}
		secrets.set(name, secret)
		owners.set(secret, name)
	}
	return { secrets, others }
}

export function ensureKeys(network: NetworkName, dir: string): AccountKeys {
	const file = keysFile(network, dir)
	const header = headerOf(network)
	const original = existsSync(file) ? readFileSync(file, "utf8") : undefined
	const { secrets, others } = parse(original ?? "", file, header)

	const created = ACCOUNT_NAMES.filter((name) => !secrets.has(name))
	const secretOf = Object.fromEntries(
		ACCOUNT_NAMES.map((name) => [
			name,
			secrets.get(name) ?? Keypair.random().secret(),
		]),
	) as Record<AccountName, string>

	const content = `${[
		header,
		...ACCOUNT_NAMES.map((name) => `${variableOf(name)}=${secretOf[name]}`),
		...others,
	].join("\n")}\n`
	if (content !== original) {
		// Replace the file whole, so a failed write never leaves it half written.
		const draft = `${file}.tmp`
		rmSync(draft, { force: true })
		writeFileSync(draft, content, { mode: 0o600 })
		renameSync(draft, file)
	}
	chmodSync(file, 0o600)

	const accounts = Object.fromEntries(
		ACCOUNT_NAMES.map((name) => [name, Keypair.fromSecret(secretOf[name])]),
	) as Accounts
	return { file, accounts, created }
}

export function readKeys(network: NetworkName, dir: string): Accounts {
	const file = keysFile(network, dir)
	if (!existsSync(file)) {
		throw new Error(
			`no key file at ${file}: the harness signs with the keys in it. Restore it from your backup.`,
		)
	}
	const { secrets } = parse(readFileSync(file, "utf8"), file, headerOf(network))
	return Object.fromEntries(
		ACCOUNT_NAMES.map((name) => {
			const secret = secrets.get(name)
			if (secret === undefined) {
				throw new Error(
					`${file} has no ${variableOf(name)}. Restore it from your backup, or deploy again to create the key.`,
				)
			}
			return [name, Keypair.fromSecret(secret)]
		}),
	) as Accounts
}

// An account an older record does not name is taken from the file unchecked.
export function keysFor(
	deployment: Pick<Deployment, "network" | "accounts">,
	dir: string,
): Accounts {
	const { network } = deployment
	const file = keysFile(network, dir)
	const keys = readKeys(network, dir)
	const recorded: Partial<Deployment["accounts"]> = deployment.accounts
	for (const name of ACCOUNT_NAMES) {
		const expected = recorded[name]?.public
		const actual = keys[name].publicKey()
		if (expected !== undefined && expected !== actual) {
			throw new Error(
				`${file}: ${variableOf(name)} is the key of ${actual}, but the deployment on ${network} was made with ${expected}`,
			)
		}
	}
	return keys
}

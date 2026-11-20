import { Networks } from "@stellar/stellar-sdk"

import {
	type MissingField,
	type OperatorValues,
	type Sep1Inputs,
} from "./stellar-toml.js"

export interface AssetListEntry {
	contract: string
	code: string
	name: string
	org: string
	domain: string
	icon: string
	decimals: number
}

export interface AssetList {
	name: string
	provider: string
	version: string
	network?: "public" | "testnet"
	assets: [AssetListEntry]
}

const CLEAN_STRING = /^[\w .,-@]*$/
const VERSION = /^\d{1,4}\.\d{1,4}$/
const CONTRACT = /^C[A-Z0-9]{55}$/
const CODE = /^[A-Za-z0-9]{1,12}$/
const DOMAIN =
	/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/
const IPFS_HASH = /^baf[a-zA-Z0-9]+$/

const LIST_KEYS = [
	"name",
	"provider",
	"description",
	"version",
	"network",
	"feedback",
	"assets",
]
const ENTRY_KEYS = [
	"name",
	"contract",
	"code",
	"issuer",
	"org",
	"domain",
	"icon",
	"decimals",
	"comment",
]
const MAX_ASSETS = 1000
const MAX_DECIMALS = 38

const NOT_CLEAN =
	"may only use letters, digits, spaces and . , - @ and the characters between , and @"
const between = (min: number, max: number) =>
	`must be ${min} to ${max} characters`

export function networkOf(
	passphrase: string | undefined,
): "public" | "testnet" | undefined {
	if (passphrase === Networks.PUBLIC) return "public"
	if (passphrase === Networks.TESTNET) return "testnet"
	return undefined
}

function sameEntry(a: AssetListEntry, b: AssetListEntry): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)])
	return [...keys].every(
		(key) => a[key as keyof AssetListEntry] === b[key as keyof AssetListEntry],
	)
}

export function nextVersion(
	previous: AssetList | undefined,
	entry: AssetListEntry,
): string {
	if (previous === undefined || !VERSION.test(previous.version)) return "1.0"
	const before = previous.assets[0]
	if (before === undefined) return "1.0"
	if (sameEntry(before, entry)) return previous.version
	const [major = 0, minor = 0] = previous.version.split(".").map(Number)
	return before.contract !== entry.contract
		? `${major + 1}.0`
		: `${major}.${minor + 1}`
}

function stringProblem(
	value: unknown,
	min: number,
	max: number,
): string | undefined {
	if (typeof value !== "string") return "must be a string"
	if (value.length < min || value.length > max) return between(min, max)
	if (!CLEAN_STRING.test(value)) return NOT_CLEAN
	return undefined
}

function iconProblem(value: unknown): string | undefined {
	if (typeof value !== "string") return "must be a string"
	if (IPFS_HASH.test(value)) return undefined
	try {
		if (new URL(value).protocol === "https:") return undefined
	} catch {
		// falls through to the shared message
	}
	return "must be an https URL or an IPFS hash"
}

function entryProblems(entry: unknown, prefix: string): MissingField[] {
	const problems: MissingField[] = []
	const add = (field: string, reason: string | undefined): void => {
		if (reason !== undefined)
			problems.push({ field: `${prefix}${field}`, reason })
	}
	if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
		add("", "must be an object")
		return problems
	}
	const record = entry as Record<string, unknown>
	for (const key of Object.keys(record))
		if (!ENTRY_KEYS.includes(key)) add(key, "is not a SEP-42 entry field")

	add("name", stringProblem(record.name, 5, 30))
	add("org", stringProblem(record.org, 5, 30))
	if (record.contract === undefined) add("contract", "is required")
	else if (
		typeof record.contract !== "string" ||
		!CONTRACT.test(record.contract)
	)
		add("contract", "must be a contract address (C followed by 55 characters)")
	if (record.code !== undefined)
		if (typeof record.code !== "string" || !CODE.test(record.code))
			add("code", "must be 1 to 12 letters or digits")
	if (record.domain !== undefined)
		if (typeof record.domain !== "string" || !DOMAIN.test(record.domain))
			add("domain", 'must be a bare host such as "example.com"')
	if (record.icon !== undefined) add("icon", iconProblem(record.icon))
	if (record.decimals !== undefined)
		if (
			typeof record.decimals !== "number" ||
			!Number.isInteger(record.decimals) ||
			record.decimals < 0 ||
			record.decimals > MAX_DECIMALS
		)
			add("decimals", `must be an integer from 0 to ${MAX_DECIMALS}`)
	return problems
}

function listProblems(list: unknown): MissingField[] {
	const problems: MissingField[] = []
	const add = (field: string, reason: string | undefined): void => {
		if (reason !== undefined)
			problems.push({ field: `assetlist.${field}`, reason })
	}
	if (typeof list !== "object" || list === null || Array.isArray(list)) {
		add("list", "must be an object")
		return problems
	}
	const record = list as Record<string, unknown>
	for (const key of Object.keys(record))
		if (!LIST_KEYS.includes(key)) add(key, "is not a SEP-42 list field")

	add("list_name", stringProblem(record.name, 5, 30))
	add("provider", stringProblem(record.provider, 5, 50))
	if (typeof record.version !== "string" || !VERSION.test(record.version))
		add("version", 'must look like "1.0"')
	if (
		record.network !== undefined &&
		record.network !== "public" &&
		record.network !== "testnet"
	)
		add("network", 'must be "public" or "testnet"')
	if (
		!Array.isArray(record.assets) ||
		record.assets.length < 1 ||
		record.assets.length > MAX_ASSETS
	)
		add("assets", `must hold 1 to ${MAX_ASSETS} entries`)
	else
		record.assets.forEach((entry, index) => {
			const prefix = index === 0 ? "assetlist." : `assetlist.assets[${index}].`
			problems.push(...entryProblems(entry, prefix))
		})
	return problems
}

export function assetListProblems(list: unknown): string[] {
	return listProblems(list).map(({ field, reason }) => `${field} ${reason}`)
}

export function buildAssetList(
	inputs: Sep1Inputs,
	operator: OperatorValues,
	previous?: AssetList,
): { list?: AssetList; missing: MissingField[] } {
	const missing: MissingField[] = []
	const unfilled = (field: string, reason: string): undefined => {
		missing.push({ field: `assetlist.${field}`, reason })
		return undefined
	}
	const fromOperator = (
		source: "ORG_NAME" | "domain" | "image",
		field: string,
	): string | undefined =>
		operator[source] ?? unfilled(field, `set ${source} in SEP1_OPERATOR`)

	const token = inputs.shareToken
	const fromToken = <T>(field: string, value: T | undefined): T | undefined =>
		value ?? unfilled(field, "no share token deployed yet")

	const contract = fromToken("contract", token?.contract)
	const code = operator.code ?? fromToken("code", token?.code)
	const name = operator.name ?? fromToken("name", token?.name)
	const decimals = fromToken("decimals", token?.decimals)
	const org = fromOperator("ORG_NAME", "org")
	const domain = fromOperator("domain", "domain")
	const icon = fromOperator("image", "icon")
	const provider =
		operator.ORG_NAME ?? unfilled("provider", "set ORG_NAME in SEP1_OPERATOR")

	const network = networkOf(inputs.networkPassphrase)
	const entry = { contract, code, name, org, domain, icon, decimals }
	const candidate = {
		name: `${code ?? "token"} asset list`,
		provider,
		version: "1.0",
		...(network === undefined ? {} : { network }),
		assets: [entry],
	}

	const reported = new Set(missing.map((m) => m.field))
	missing.push(
		...listProblems(candidate).filter(
			(problem) => !reported.has(problem.field),
		),
	)
	if (missing.length > 0) return { missing }

	const complete = entry as AssetListEntry
	const base = previous?.network === network ? previous : undefined
	const list: AssetList = {
		...(candidate as Omit<AssetList, "version" | "assets">),
		version: nextVersion(base, complete),
		assets: [complete],
	}
	return { list, missing }
}

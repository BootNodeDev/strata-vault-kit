import { Networks } from "@stellar/stellar-sdk"

export const OPERATOR_FIELDS = [
	"ORG_NAME",
	"ORG_URL",
	"ORG_LOGO",
	"ORG_DESCRIPTION",
	"ORG_OFFICIAL_EMAIL",
	"ORG_SUPPORT_EMAIL",
	"desc",
	"image",
	"anchor_asset_type",
	"anchor_asset",
	"redemption_instructions",
] as const

export type OperatorField = (typeof OPERATOR_FIELDS)[number]
export type OperatorValues = Partial<Record<OperatorField, string>>

export interface Sep1Inputs {
	networkPassphrase?: string
	shareToken?: {
		contract: string
		code: string
		name: string
		decimals: number
	}
	report?: { proofUri: string; proofHash: string; acceptedAt: bigint }
	feed?: string
}

export interface MissingField {
	field: string
	reason: string
}

const VERSION = "2.7.0"
const CODE_LIMIT = 12
const NAME_LIMIT = 20
const DISPLAY_DECIMALS_LIMIT = 7

const DOCUMENTATION_FIELDS: OperatorField[] = [
	"ORG_NAME",
	"ORG_URL",
	"ORG_LOGO",
	"ORG_DESCRIPTION",
	"ORG_OFFICIAL_EMAIL",
	"ORG_SUPPORT_EMAIL",
]

const HEADER = [
	"# SEP-1 asset metadata (stellar.toml) for the share token.",
	'# Placeholders look like "<NAME>"; regenerate with',
	"# `npm run sep1 -w scripts/harness` once the vault is deployed.",
]

export function parseOperatorValues(json: unknown): OperatorValues {
	if (typeof json !== "object" || json === null)
		throw new Error("operator values must be a JSON object")
	const result: OperatorValues = {}
	for (const [key, value] of Object.entries(json)) {
		if (!(OPERATOR_FIELDS as readonly string[]).includes(key))
			throw new Error(`unknown operator field "${key}"`)
		if (typeof value !== "string")
			throw new Error(`operator field "${key}" must be a string`)
		result[key as OperatorField] = value
	}
	return result
}

const quote = (value: string): string => JSON.stringify(value)
const open = (field: string): string => quote(`<${field}>`)

function missingField(
	field: string,
	reason: string,
	missing: MissingField[],
): string {
	missing.push({ field, reason })
	return open(field)
}

function limited(
	value: string,
	limit: number,
	field: string,
	missing: MissingField[],
): string {
	if (value.length <= limit) return quote(value)
	missing.push({
		field,
		reason: `${value.length} characters, over SEP-1's ${limit}-character limit`,
	})
	return open(field)
}

function operatorOrOpen(
	operator: OperatorValues,
	field: OperatorField,
): string {
	const value = operator[field]
	return value !== undefined ? quote(value) : open(field)
}

function documentationLines(operator: OperatorValues): string[] {
	return DOCUMENTATION_FIELDS.map(
		(field) => `${field} = ${operatorOrOpen(operator, field)}`,
	)
}

// Only the token's status: SEP-1 defines it from the chain's network, not the token.
function status(inputs: Sep1Inputs, missing: MissingField[]): string {
	if (inputs.networkPassphrase === undefined)
		return missingField("status", "no network passphrase given", missing)
	return quote(inputs.networkPassphrase === Networks.PUBLIC ? "live" : "test")
}

function currencyLines(
	inputs: Sep1Inputs,
	operator: OperatorValues,
	missing: MissingField[],
): string[] {
	const token = inputs.shareToken
	const noToken = (field: string): string =>
		missingField(field, "no share token deployed yet", missing)

	const code = token
		? limited(token.code, CODE_LIMIT, "code", missing)
		: noToken("code")
	const contract = token ? quote(token.contract) : noToken("contract")
	const displayDecimals = token
		? String(Math.min(token.decimals, DISPLAY_DECIMALS_LIMIT))
		: noToken("display_decimals")
	const name = token
		? limited(token.name, NAME_LIMIT, "name", missing)
		: noToken("name")
	const attestationOfReserve = inputs.report
		? quote(inputs.report.proofUri)
		: missingField(
				"attestation_of_reserve",
				"no accepted attestation report yet",
				missing,
			)

	const lines = [
		`code = ${code}`,
		`contract = ${contract}`,
		`status = ${status(inputs, missing)}`,
		`display_decimals = ${displayDecimals}`,
		`name = ${name}`,
		`desc = ${operatorOrOpen(operator, "desc")}`,
		`image = ${operatorOrOpen(operator, "image")}`,
		"is_asset_anchored = true",
		`anchor_asset_type = ${operatorOrOpen(operator, "anchor_asset_type")}`,
		`anchor_asset = ${operatorOrOpen(operator, "anchor_asset")}`,
	]
	if (inputs.report) {
		lines.push(`# proof hash: ${inputs.report.proofHash}`)
		lines.push(
			`# accepted at: ${new Date(Number(inputs.report.acceptedAt) * 1000).toISOString()}`,
		)
	}
	lines.push(`attestation_of_reserve = ${attestationOfReserve}`)
	lines.push(
		`redemption_instructions = ${operatorOrOpen(operator, "redemption_instructions")}`,
	)
	return lines
}

export function renderStellarToml(
	inputs: Sep1Inputs,
	operator: OperatorValues = {},
): { toml: string; missing: MissingField[] } {
	const missing: MissingField[] = []

	const networkPassphrase =
		inputs.networkPassphrase !== undefined
			? quote(inputs.networkPassphrase)
			: missingField(
					"NETWORK_PASSPHRASE",
					"no network passphrase given",
					missing,
				)

	const lines = [
		...HEADER,
		"",
		`VERSION = ${quote(VERSION)}`,
		`NETWORK_PASSPHRASE = ${networkPassphrase}`,
		"",
		"[DOCUMENTATION]",
		...documentationLines(operator),
		"",
	]
	if (inputs.feed !== undefined)
		lines.push(`# SEP-40 price feed: ${inputs.feed}`)
	lines.push("[[CURRENCIES]]", ...currencyLines(inputs, operator, missing))

	return { toml: `${lines.join("\n")}\n`, missing }
}

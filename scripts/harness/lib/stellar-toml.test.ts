import { readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { join } from "node:path"

import { Networks, StellarToml, StrKey } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { REPO_ROOT } from "./deployment.js"
import {
	parseOperatorValues,
	renderStellarToml,
	type OperatorValues,
	type Sep1Inputs,
} from "./stellar-toml.js"

const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7))
const FEED = StrKey.encodeContract(Buffer.alloc(32, 9))

const FULL_INPUTS: Sep1Inputs = {
	networkPassphrase: Networks.PUBLIC,
	shareToken: {
		contract: CONTRACT,
		code: "STRATA",
		name: "Strata Share",
		decimals: 7,
	},
	report: {
		proofUri: "https://example.com/proof.json",
		proofHash: "deadbeef",
		acceptedAt: 1_700_000_000n,
	},
	feed: FEED,
}

const FULL_OPERATOR: OperatorValues = {
	ORG_NAME: "Acme",
	ORG_URL: "https://acme.example",
	ORG_LOGO: "https://acme.example/logo.png",
	ORG_DESCRIPTION: "Acme Corp",
	ORG_OFFICIAL_EMAIL: "official@acme.example",
	ORG_SUPPORT_EMAIL: "support@acme.example",
	desc: "Share of the Acme vault",
	image: "https://acme.example/share.png",
	anchor_asset_type: "other",
	anchor_asset: "ACME-RWA",
	redemption_instructions: "Contact support",
}

// Starts a server on an ephemeral port that answers the well-known path with
// `toml`, so a real resolver can fetch and parse it.
function serveToml(
	toml: string,
): Promise<{ port: number; close: () => Promise<void> }> {
	return new Promise((resolvePromise, reject) => {
		const server: Server = createServer((req, res) => {
			if (req.url === "/.well-known/stellar.toml") {
				res.writeHead(200, { "content-type": "text/plain" })
				res.end(toml)
				return
			}
			res.writeHead(404)
			res.end()
		})
		server.on("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			if (address === null || typeof address === "string") {
				reject(new Error("expected an AddressInfo"))
				return
			}
			resolvePromise({
				port: address.port,
				close: () => new Promise((res) => server.close(() => res())),
			})
		})
	})
}

async function resolveToml(toml: string): Promise<StellarToml.Api.StellarToml> {
	const { port, close } = await serveToml(toml)
	try {
		return await StellarToml.Resolver.resolve(`127.0.0.1:${port}`, {
			allowHttp: true,
		})
	} finally {
		await close()
	}
}

describe("renderStellarToml", () => {
	it("a full deployment fills every chain field", () => {
		const { toml, missing } = renderStellarToml(FULL_INPUTS, FULL_OPERATOR)

		expect(missing).toEqual([])
		expect(toml).toContain(`contract = ${JSON.stringify(CONTRACT)}`)
		expect(toml).toContain(
			`attestation_of_reserve = ${JSON.stringify(FULL_INPUTS.report?.proofUri)}`,
		)
		expect(toml).toContain("# proof hash: deadbeef")
		expect(toml).toContain("# accepted at: 2023-11-14T22:13:20.000Z")
		expect(toml).toContain(`# SEP-40 price feed: ${FEED}`)
	})

	it("no attestation leaves the proof open", () => {
		const { report: _report, ...inputs } = FULL_INPUTS
		const { toml, missing } = renderStellarToml(inputs, FULL_OPERATOR)

		expect(toml).toContain(
			'attestation_of_reserve = "<attestation_of_reserve>"',
		)
		expect(toml).not.toContain("# proof hash:")
		expect(missing).toContainEqual(
			expect.objectContaining({ field: "attestation_of_reserve" }),
		)
	})

	it("no feed omits its comment", () => {
		const { feed: _feed, ...inputs } = FULL_INPUTS
		const full = renderStellarToml(FULL_INPUTS, FULL_OPERATOR)
		const withoutFeed = renderStellarToml(inputs, FULL_OPERATOR)

		expect(withoutFeed.toml).not.toContain("SEP-40 price feed")
		expect(withoutFeed.toml).toBe(
			full.toml.replace(`# SEP-40 price feed: ${FEED}\n`, ""),
		)
		expect(withoutFeed.missing).toEqual(full.missing)
	})

	it("values past SEP-1 limits stay open", () => {
		const inputs: Sep1Inputs = {
			networkPassphrase: Networks.TESTNET,
			shareToken: {
				contract: CONTRACT,
				code: "ABCDEFGHIJKLM",
				name: "A".repeat(21),
				decimals: 18,
			},
		}
		const { toml, missing } = renderStellarToml(inputs)

		expect(toml).toContain('code = "<code>"')
		expect(toml).toContain('name = "<name>"')
		expect(toml).toContain("display_decimals = 7")
		expect(missing).toContainEqual(
			expect.objectContaining({
				field: "code",
				reason: expect.stringContaining("12"),
			}),
		)
		expect(missing).toContainEqual(
			expect.objectContaining({
				field: "name",
				reason: expect.stringContaining("20"),
			}),
		)
	})

	it("values are escaped", async () => {
		const trickyName = 'Qu"ote\\slash\nline'
		const trickyDesc = 'Desc with "quotes", a \\ backslash, and\na newline'
		const inputs: Sep1Inputs = {
			...FULL_INPUTS,
			shareToken: { ...FULL_INPUTS.shareToken!, name: trickyName },
		}
		const operator: OperatorValues = { ...FULL_OPERATOR, desc: trickyDesc }

		const { toml } = renderStellarToml(inputs, operator)
		const parsed = await resolveToml(toml)

		expect(parsed.CURRENCIES?.[0]?.name).toBe(trickyName)
		expect(parsed.CURRENCIES?.[0]?.desc).toBe(trickyDesc)
	})

	it("operator values are checked", () => {
		expect(() => parseOperatorValues({ ORG_NAME: "x", nope: "y" })).toThrow(
			/nope/,
		)
		expect(() => parseOperatorValues({ ORG_NAME: 1 })).toThrow(/ORG_NAME/)
	})

	it("wallets parse the output", async () => {
		const full = renderStellarToml(FULL_INPUTS, FULL_OPERATOR)
		const empty = renderStellarToml({})

		const fullParsed = await resolveToml(full.toml)
		expect(fullParsed.CURRENCIES?.[0]?.contract).toBe(CONTRACT)
		expect(fullParsed.CURRENCIES?.[0]?.attestation_of_reserve).toBe(
			FULL_INPUTS.report?.proofUri,
		)

		const emptyParsed = await resolveToml(empty.toml)
		expect(emptyParsed.CURRENCIES?.[0]?.contract).toBe("<contract>")
		expect(emptyParsed.CURRENCIES?.[0]?.attestation_of_reserve).toBe(
			"<attestation_of_reserve>",
		)
	})

	it("the committed template is the empty render", () => {
		const template = readFileSync(
			join(REPO_ROOT, "docs", "sep1", "stellar.template.toml"),
			"utf8",
		)
		expect(template).toBe(renderStellarToml({}).toml)
	})
})

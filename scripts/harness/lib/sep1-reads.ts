import { type Connected, oracle, shareToken } from "./clients.js"
import { outcome, type HasSpec } from "./refused.js"
import { type Sep1Inputs } from "./stellar-toml.js"

export interface ChainReads {
	networkPassphrase: string
	shareToken: {
		contract: string
		name: string
		symbol: string
		decimals: number
	}
	report?: {
		proof_uri: string
		proof_hash: Buffer
		accepted_at: bigint
		expires_at: bigint
	}
	feed?: string
}

export function toSep1Inputs(reads: ChainReads): Sep1Inputs {
	return {
		networkPassphrase: reads.networkPassphrase,
		shareToken: {
			contract: reads.shareToken.contract,
			code: reads.shareToken.symbol,
			name: reads.shareToken.name,
			decimals: reads.shareToken.decimals,
		},
		...(reads.report !== undefined
			? {
					report: {
						proofUri: reads.report.proof_uri,
						proofHash: reads.report.proof_hash.toString("hex"),
						acceptedAt: reads.report.accepted_at,
						expiresAt: reads.report.expires_at,
					},
				}
			: {}),
		...(reads.feed !== undefined ? { feed: reads.feed } : {}),
	}
}

interface ReportReader extends HasSpec {
	latest(): Promise<{
		result: {
			proof_uri: string
			proof_hash: Buffer
			accepted_at: bigint
			expires_at: bigint
		}
		simulation?: unknown
	}>
}

export async function latestReport(
	reader: ReportReader,
): Promise<ChainReads["report"]> {
	const tx = await reader.latest()
	const result = outcome(tx, reader)
	if (result === "refused: NoRecord") return undefined
	if (result !== "accepted") throw new Error(result)
	return {
		proof_uri: tx.result.proof_uri,
		proof_hash: tx.result.proof_hash,
		accepted_at: tx.result.accepted_at,
		expires_at: tx.result.expires_at,
	}
}

export async function readSep1Inputs(c: Connected): Promise<Sep1Inputs> {
	const token = shareToken(c, c.keys.outsider)
	const [name, symbol, decimals, report] = await Promise.all([
		token.name(),
		token.symbol(),
		token.decimals(),
		latestReport(oracle(c, c.keys.outsider)),
	])
	const feed = c.deployment.contracts.sep40_feed

	return toSep1Inputs({
		networkPassphrase: c.net.passphrase,
		shareToken: {
			contract: c.deployment.contracts.share_token,
			name: name.result,
			symbol: symbol.result,
			decimals: decimals.result,
		},
		...(report !== undefined ? { report } : {}),
		...(feed !== undefined ? { feed } : {}),
	})
}

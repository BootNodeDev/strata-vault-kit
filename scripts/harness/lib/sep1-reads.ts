import { type Connected, oracle, shareToken } from "./clients.js"
import { outcome } from "./refused.js"
import { type Sep1Inputs } from "./stellar-toml.js"

export interface ChainReads {
	networkPassphrase: string
	shareToken: {
		contract: string
		name: string
		symbol: string
		decimals: number
	}
	report?: { proof_uri: string; proof_hash: Buffer; accepted_at: bigint }
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
					},
				}
			: {}),
		...(reads.feed !== undefined ? { feed: reads.feed } : {}),
	}
}

async function latestReport(c: Connected): Promise<ChainReads["report"]> {
	const reader = oracle(c, c.keys.outsider)
	const tx = await reader.latest()
	const result = outcome(tx, reader)
	if (result === "refused: NoRecord") return undefined
	if (result !== "accepted") throw new Error(result)
	return {
		proof_uri: tx.result.proof_uri,
		proof_hash: tx.result.proof_hash,
		accepted_at: tx.result.accepted_at,
	}
}

// The one place that reads the chain; `toSep1Inputs` does the mapping, so a
// unit test can exercise it with fake results instead of a live connection.
export async function readSep1Inputs(c: Connected): Promise<Sep1Inputs> {
	const token = shareToken(c, c.keys.outsider)
	const [name, symbol, decimals, report] = await Promise.all([
		token.name(),
		token.symbol(),
		token.decimals(),
		latestReport(c),
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

import { Networks } from "@stellar/stellar-sdk"

import { WAD } from "./amounts.js"

export type NetworkName = "local" | "testnet"

export interface OracleConfig {
	freshness_duration: number
	cooldown_secs: number
	max_up_bps: number
	max_down_bps: number | null
	min_answer: string
	max_answer: string
}

export type Funding =
	{ kind: "root"; secret: string } | { kind: "friendbot"; url: string }

export interface Network {
	name: NetworkName
	rpcUrl: string
	passphrase: string
	funding: Funding
	oracle: OracleConfig
}

// The band is the protocol's; only the two waits are the fixture's choice.
const band = {
	max_up_bps: 1000,
	max_down_bps: null,
	min_answer: (WAD / 2n).toString(),
	max_answer: (WAD * 100n).toString(),
}

// The quickstart image's standalone root key. Public, and worthless off a laptop.
const QUICKSTART_ROOT =
	"SC5O7VZUXDJ6JBDSZ74DSERXL7W3Y5LTOAMRF7RQRL3TAGAPS7LUVG3L"

const NETWORKS: Record<NetworkName, Network> = {
	local: {
		name: "local",
		rpcUrl: process.env["HARNESS_RPC_URL"] ?? "http://localhost:8000/rpc",
		passphrase: Networks.STANDALONE,
		funding: {
			kind: "root",
			secret: process.env["HARNESS_ROOT_SECRET"] ?? QUICKSTART_ROOT,
		},
		oracle: { freshness_duration: 300, cooldown_secs: 5, ...band },
	},
	testnet: {
		name: "testnet",
		rpcUrl:
			process.env["HARNESS_RPC_URL"] ?? "https://soroban-testnet.stellar.org",
		passphrase: Networks.TESTNET,
		funding: { kind: "friendbot", url: "https://friendbot.stellar.org" },
		oracle: { freshness_duration: 3600, cooldown_secs: 60, ...band },
	},
}

export function network(): Network {
	const wanted = process.env["HARNESS_NETWORK"] ?? "local"
	if (!Object.hasOwn(NETWORKS, wanted)) {
		throw new Error(
			`unknown HARNESS_NETWORK ${wanted}; expected ${Object.keys(NETWORKS).join(" or ")}`,
		)
	}
	return NETWORKS[wanted as NetworkName]
}

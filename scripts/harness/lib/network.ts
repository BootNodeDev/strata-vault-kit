import { Networks } from "@stellar/stellar-sdk"

import { WAD } from "./amounts.js"

export type NetworkName = "local" | "testnet"

export interface OracleConfig {
	freshness_duration: number
	cooldown_secs: number
	max_up_bps: number
	max_down_bps: number
	min_answer: string
	max_answer: string
}

export interface VaultConfig {
	notice_secs: number
}

export type Funding =
	{ kind: "root"; secret: string } | { kind: "friendbot"; url: string }

export interface Network {
	name: NetworkName
	rpcUrl: string
	passphrase: string
	funding: Funding
	oracle: OracleConfig
	vault: VaultConfig
}

// The band is the protocol's; only the two waits are the fixture's choice.
// A fall of any size lands at once, as a real loss must.
const band = {
	max_up_bps: 1000,
	max_down_bps: 10_000,
	min_answer: (WAD / 2n).toString(),
	max_answer: (WAD * 100n).toString(),
}

// The quickstart image's standalone root key. Public, and worthless off a laptop.
const QUICKSTART_ROOT =
	"SC5O7VZUXDJ6JBDSZ74DSERXL7W3Y5LTOAMRF7RQRL3TAGAPS7LUVG3L"

const LOCAL_COOLDOWN_SECS = 5
const TESTNET_COOLDOWN_SECS = 60

// Twice the cooldown, so a valuation attested after the close lands before the notice ends.
const noticeFor = (cooldownSecs: number): VaultConfig => ({
	notice_secs: 2 * cooldownSecs,
})

const NETWORKS: Record<NetworkName, Network> = {
	local: {
		name: "local",
		rpcUrl: process.env["HARNESS_RPC_URL"] ?? "http://localhost:8000/rpc",
		passphrase: Networks.STANDALONE,
		funding: {
			kind: "root",
			secret: process.env["HARNESS_ROOT_SECRET"] ?? QUICKSTART_ROOT,
		},
		oracle: {
			freshness_duration: 300,
			cooldown_secs: LOCAL_COOLDOWN_SECS,
			...band,
		},
		vault: noticeFor(LOCAL_COOLDOWN_SECS),
	},
	testnet: {
		name: "testnet",
		rpcUrl:
			process.env["HARNESS_RPC_URL"] ?? "https://soroban-testnet.stellar.org",
		passphrase: Networks.TESTNET,
		funding: { kind: "friendbot", url: "https://friendbot.stellar.org" },
		oracle: {
			freshness_duration: 3600,
			cooldown_secs: TESTNET_COOLDOWN_SECS,
			...band,
		},
		vault: noticeFor(TESTNET_COOLDOWN_SECS),
	},
}

export function networkNamed(name: string): Network {
	if (!Object.hasOwn(NETWORKS, name)) {
		throw new Error(
			`unknown network ${name}; expected ${Object.keys(NETWORKS).join(" or ")}`,
		)
	}
	return NETWORKS[name as NetworkName]
}

export function network(): Network {
	const argIdx = process.argv.indexOf("--network")
	const argVal = argIdx !== -1 ? process.argv[argIdx + 1] : undefined
	const wanted = process.env["HARNESS_NETWORK"] ?? argVal ?? "local"
	if (!Object.hasOwn(NETWORKS, wanted)) {
		throw new Error(
			`unknown HARNESS_NETWORK ${wanted}; expected ${Object.keys(NETWORKS).join(" or ")}`,
		)
	}
	return NETWORKS[wanted as NetworkName]
}

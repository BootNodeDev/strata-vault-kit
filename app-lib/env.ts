import { parseNetworkEnv } from "./networkEnv"

type NetworkType = "mainnet" | "testnet" | "futurenet" | "local"

interface Network {
	id: NetworkType
	label: string
	passphrase: string
	rpcUrl: string
	horizonUrl: string
}

const env = parseNetworkEnv(import.meta.env)

export const stellarNetwork =
	env.PUBLIC_STELLAR_NETWORK === "STANDALONE"
		? "LOCAL"
		: env.PUBLIC_STELLAR_NETWORK
export const networkPassphrase = env.PUBLIC_STELLAR_NETWORK_PASSPHRASE

const stellarEncode = (str: string) => {
	return str.replace(/\//g, "//").replace(/;/g, "/;")
}

/** Explorer page for a contract, or null on a network with no public one. */
export const explorerContract = (contractId: string): string | null => {
	switch (stellarNetwork) {
		case "PUBLIC":
			return `https://stellar.expert/explorer/public/contract/${contractId}`
		case "TESTNET":
			return `https://stellar.expert/explorer/testnet/contract/${contractId}`
		default:
			return null
	}
}

/** Explorer page for a transaction, or null on a network with no public one. */
export const explorerTransaction = (hash: string): string | null => {
	switch (stellarNetwork) {
		case "PUBLIC":
			return `https://stellar.expert/explorer/public/tx/${hash}`
		case "TESTNET":
			return `https://stellar.expert/explorer/testnet/tx/${hash}`
		default:
			return null
	}
}

export const labPrefix = () => {
	switch (stellarNetwork) {
		case "LOCAL":
			return `http://localhost:8000/lab/transaction-dashboard?$=network$id=custom&label=Custom&horizonUrl=${stellarEncode(horizonUrl)}&rpcUrl=${stellarEncode(rpcUrl)}&passphrase=${stellarEncode(networkPassphrase)};`
		case "PUBLIC":
			return `https://lab.stellar.org/transaction-dashboard?$=network$id=mainnet&label=Mainnet&horizonUrl=${stellarEncode(horizonUrl)}&rpcUrl=${stellarEncode(rpcUrl)}&passphrase=${stellarEncode(networkPassphrase)};`
		case "TESTNET":
			return `https://lab.stellar.org/transaction-dashboard?$=network$id=testnet&label=Testnet&horizonUrl=${stellarEncode(horizonUrl)}&rpcUrl=${stellarEncode(rpcUrl)}&passphrase=${stellarEncode(networkPassphrase)};`
		case "FUTURENET":
			return `https://lab.stellar.org/transaction-dashboard?$=network$id=futurenet&label=Futurenet&horizonUrl=${stellarEncode(horizonUrl)}&rpcUrl=${stellarEncode(rpcUrl)}&passphrase=${stellarEncode(networkPassphrase)};`
		default:
			return `https://lab.stellar.org/transaction-dashboard?$=network$id=testnet&label=Testnet&horizonUrl=${stellarEncode(horizonUrl)}&rpcUrl=${stellarEncode(rpcUrl)}&passphrase=${stellarEncode(networkPassphrase)};`
	}
}

// NOTE: needs to be exported for contract files in this directory
export const rpcUrl = env.PUBLIC_STELLAR_RPC_URL
export const horizonUrl = env.PUBLIC_STELLAR_HORIZON_URL

const networkToId = (network: string): NetworkType => {
	switch (network) {
		case "PUBLIC":
			return "mainnet"
		case "TESTNET":
			return "testnet"
		case "FUTURENET":
			return "futurenet"
		default:
			return "local"
	}
}

export const network: Network = {
	id: networkToId(stellarNetwork),
	label: stellarNetwork.toLowerCase(),
	passphrase: networkPassphrase,
	rpcUrl: rpcUrl,
	horizonUrl: horizonUrl,
}

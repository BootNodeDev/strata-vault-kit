import { Networks } from "@stellar/stellar-sdk"
import { z } from "zod"

const envSchema = z.object({
	PUBLIC_STELLAR_NETWORK: z.enum([
		"PUBLIC",
		"FUTURENET",
		"TESTNET",
		"LOCAL",
		"STANDALONE", // deprecated in favor of LOCAL
	] as const),
	PUBLIC_STELLAR_NETWORK_PASSPHRASE: z.enum(Networks),
	PUBLIC_STELLAR_RPC_URL: z.string().min(1),
	PUBLIC_STELLAR_HORIZON_URL: z.string().min(1),
})

type NetworkEnv = z.infer<typeof envSchema>

const localEnv: NetworkEnv = {
	PUBLIC_STELLAR_NETWORK: "LOCAL",
	PUBLIC_STELLAR_NETWORK_PASSPHRASE: Networks.STANDALONE,
	PUBLIC_STELLAR_RPC_URL: "http://localhost:8000/rpc",
	PUBLIC_STELLAR_HORIZON_URL: "http://localhost:8000",
}

const localNetworks = [undefined, "LOCAL", "STANDALONE"]

export function parseNetworkEnv(
	env: Record<string, string | undefined>,
): NetworkEnv {
	const parsed = envSchema.safeParse(env)
	if (parsed.success) return parsed.data
	if (localNetworks.includes(env.PUBLIC_STELLAR_NETWORK?.toUpperCase()))
		return localEnv
	const invalid = parsed.error.issues.map(({ path }) => String(path[0]))
	throw new Error(
		`Invalid Stellar network configuration: ${invalid.join(", ")}`,
	)
}

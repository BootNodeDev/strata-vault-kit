import {
	Client,
	type AssembledTransaction,
	type MethodOptions,
	type i128,
} from "@stellar/stellar-sdk/contract"
import { network, networkPassphrase, rpcUrl } from "./env"

export interface AsyncVaultViews {
	liquid_reserve: (
		options?: MethodOptions,
	) => Promise<AssembledTransaction<i128>>
	committed: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>
	uncovered: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>
	total_economic_supply: (
		options?: MethodOptions,
	) => Promise<AssembledTransaction<i128>>
	net_deployed: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>
}

export const connectAsyncVault = (
	contractId: string,
): Promise<AsyncVaultViews> =>
	Client.from<AsyncVaultViews>({
		contractId,
		rpcUrl,
		networkPassphrase,
		allowHttp: network.id === "local",
	})

import {
	Client,
	type AssembledTransaction,
	type MethodOptions,
	type Option,
	type i128,
	type u64,
} from "@stellar/stellar-sdk/contract"
import { network, networkPassphrase, rpcUrl } from "./env"

type View<T> = (options?: MethodOptions) => Promise<AssembledTransaction<T>>

export interface AsyncVaultViews {
	liquid_reserve: View<i128>
	committed: View<i128>
	uncovered: View<i128>
	total_economic_supply: View<i128>
	net_deployed: View<i128>
	governance: View<Option<string>>
	manager: View<Option<string>>
	treasury: View<Option<string>>
	guardian: View<Option<string>>
	custodian: View<Option<string>>
}

export type OracleState =
	| { tag: "Valid"; values: void }
	| { tag: "Stale"; values: void }
	| { tag: "Paused"; values: void }

export interface NavReport {
	nav_per_share: i128
	expires_at: u64
	timestamp: u64
}

export interface NavOracleViews {
	state: View<OracleState>
	latest: View<NavReport>
}

const clientOptions = (contractId: string) => ({
	contractId,
	rpcUrl,
	networkPassphrase,
	allowHttp: network.id === "local",
})

export const connectAsyncVault = (
	contractId: string,
): Promise<AsyncVaultViews> =>
	Client.from<AsyncVaultViews>(clientOptions(contractId))

export const connectNavOracle = (contractId: string): Promise<NavOracleViews> =>
	Client.from<NavOracleViews>(clientOptions(contractId))

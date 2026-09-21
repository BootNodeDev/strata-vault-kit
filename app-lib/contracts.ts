import {
	Client,
	type AssembledTransaction,
	type MethodOptions,
	type Option,
	type i128,
	type u64,
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
	governance: (
		options?: MethodOptions,
	) => Promise<AssembledTransaction<Option<string>>>
	manager: (
		options?: MethodOptions,
	) => Promise<AssembledTransaction<Option<string>>>
	treasury: (
		options?: MethodOptions,
	) => Promise<AssembledTransaction<Option<string>>>
	guardian: (
		options?: MethodOptions,
	) => Promise<AssembledTransaction<Option<string>>>
	custodian: (
		options?: MethodOptions,
	) => Promise<AssembledTransaction<Option<string>>>
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
	state: (options?: MethodOptions) => Promise<AssembledTransaction<OracleState>>
	latest: (options?: MethodOptions) => Promise<AssembledTransaction<NavReport>>
}

export const connectNavOracle = (contractId: string): Promise<NavOracleViews> =>
	Client.from<NavOracleViews>({
		contractId,
		rpcUrl,
		networkPassphrase,
		allowHttp: network.id === "local",
	})

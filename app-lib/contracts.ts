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
type ViewOf<A, T> = (
	args: A,
	options?: MethodOptions,
) => Promise<AssembledTransaction<T>>

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
	current_epoch: View<u64>
	get_epoch: ViewOf<{ epoch_id: u64 }, Option<EpochInfo>>
	get_deposit_request: ViewOf<
		{ epoch_id: u64; controller: string },
		Option<DepositRequest>
	>
	get_redeem_request: ViewOf<
		{ epoch_id: u64; controller: string },
		Option<RedeemRequest>
	>
}

export type EpochStatus =
	| { tag: "Open"; values: void }
	| { tag: "Pending"; values: void }
	| { tag: "Fulfilled"; values: void }

export interface EpochInfo {
	status: EpochStatus
	total_deposited: i128
	total_shares_redeeming: i128
	share_price: i128
	closed_at: u64
	priceable_at: u64
}

export interface DepositRequest {
	amount: i128
	claimed: boolean
}

export interface RedeemRequest {
	shares: i128
	claimed: boolean
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

export interface IdentityVerifierViews {
	is_allowed: ViewOf<{ account: string }, boolean>
}

export interface ShareTokenViews {
	balance: ViewOf<{ account: string }, i128>
	symbol: View<string>
	name: View<string>
}

export interface AssetViews {
	symbol: View<string>
	balance: ViewOf<{ id: string }, i128>
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

export const connectIdentityVerifier = (
	contractId: string,
): Promise<IdentityVerifierViews> =>
	Client.from<IdentityVerifierViews>(clientOptions(contractId))

export const connectShareToken = (
	contractId: string,
): Promise<ShareTokenViews> =>
	Client.from<ShareTokenViews>(clientOptions(contractId))

export const connectAsset = (contractId: string): Promise<AssetViews> =>
	Client.from<AssetViews>(clientOptions(contractId))

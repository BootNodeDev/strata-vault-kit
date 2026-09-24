import {
	AssembledTransaction,
	Client,
	type MethodOptions,
	type SignTransaction,
	type i128,
	type u64,
} from "@stellar/stellar-sdk/contract"
import { network, networkPassphrase, rpcUrl } from "./env"

type Call<T> = (options?: MethodOptions) => Promise<AssembledTransaction<T>>
type CallOf<A, T> = (
	args: A,
	options?: MethodOptions,
) => Promise<AssembledTransaction<T>>

export type Option<T> = T | null

export interface Signer {
	publicKey: string
	signTransaction: SignTransaction
}

export interface AsyncVaultApi {
	liquid_reserve: Call<i128>
	committed: Call<i128>
	uncovered: Call<i128>
	total_economic_supply: Call<i128>
	net_deployed: Call<i128>
	governance: Call<Option<string>>
	manager: Call<Option<string>>
	treasury: Call<Option<string>>
	guardian: Call<Option<string>>
	custodian: Call<Option<string>>
	paused: Call<boolean>
	current_epoch: Call<u64>
	get_epoch: CallOf<{ epoch_id: u64 }, Option<EpochInfo>>
	get_deposit_request: CallOf<
		{ epoch_id: u64; controller: string },
		Option<DepositRequest>
	>
	get_redeem_request: CallOf<
		{ epoch_id: u64; controller: string },
		Option<RedeemRequest>
	>
	request_deposit: CallOf<{ from: string; amount: i128 }, u64>
	cancel_deposit: CallOf<{ from: string; epoch_id: u64 }, i128>
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

export interface NavOracleApi {
	state: Call<OracleState>
	latest: Call<NavReport>
}

export interface IdentityVerifierApi {
	is_allowed: CallOf<{ account: string }, boolean>
}

export interface ShareTokenApi {
	balance: CallOf<{ account: string }, i128>
	symbol: Call<string>
	name: Call<string>
}

export interface AssetApi {
	symbol: Call<string>
	balance: CallOf<{ id: string }, i128>
}

const clientOptions = (contractId: string, signer?: Signer) => ({
	contractId,
	rpcUrl,
	networkPassphrase,
	allowHttp: network.id === "local",
	publicKey: signer?.publicKey,
	signTransaction: signer?.signTransaction,
})

export const connectAsyncVault = (
	contractId: string,
	signer?: Signer,
): Promise<AsyncVaultApi> =>
	Client.from<AsyncVaultApi>(clientOptions(contractId, signer))

export const isUserRejection = (error: unknown): boolean =>
	error instanceof AssembledTransaction.Errors.UserRejected

export const connectNavOracle = (contractId: string): Promise<NavOracleApi> =>
	Client.from<NavOracleApi>(clientOptions(contractId))

export const connectIdentityVerifier = (
	contractId: string,
): Promise<IdentityVerifierApi> =>
	Client.from<IdentityVerifierApi>(clientOptions(contractId))

export const connectShareToken = (contractId: string): Promise<ShareTokenApi> =>
	Client.from<ShareTokenApi>(clientOptions(contractId))

export const connectAsset = (contractId: string): Promise<AssetApi> =>
	Client.from<AssetApi>(clientOptions(contractId))

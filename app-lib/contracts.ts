import {
	AssembledTransaction,
	type MethodOptions,
	type SignTransaction,
} from "@stellar/stellar-sdk/contract"
import { network, networkPassphrase, rpcUrl } from "./env"
import { server } from "./rpc"
import { Client as AssetApi } from "./clients/asset/src/index"
import {
	Client as AsyncVaultApi,
	type DepositRequest,
	type EpochInfo,
	type EpochStatus,
	type RedeemRequest,
	type VaultChange,
	type VaultPendingChange,
} from "./clients/async_vault/src/index"
import { Client as IdentityVerifierApi } from "./clients/identity_verifier/src/index"
import {
	Client as NavOracleApi,
	type NavReport,
	type OracleState,
} from "./clients/nav_oracle/src/index"
import { Client as ShareTokenApi } from "./clients/share_token/src/index"

export type {
	AssetApi,
	AsyncVaultApi,
	DepositRequest,
	EpochInfo,
	EpochStatus,
	IdentityVerifierApi,
	NavOracleApi,
	NavReport,
	OracleState,
	RedeemRequest,
	ShareTokenApi,
	VaultChange,
	VaultPendingChange,
}

export interface Signer {
	publicKey: string
	signTransaction: SignTransaction
}

export type ConnectOptions = Pick<MethodOptions, "timeoutInSeconds">

const clientOptions = (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
) => ({
	contractId,
	rpcUrl,
	networkPassphrase,
	allowHttp: network.id === "local",
	publicKey: signer?.publicKey,
	signTransaction: signer?.signTransaction,
	timeoutInSeconds: options?.timeoutInSeconds,
	server,
})

export const connectAsyncVault = async (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<AsyncVaultApi> =>
	new AsyncVaultApi(clientOptions(contractId, signer, options))

export const isUserRejection = (error: unknown): boolean =>
	error instanceof AssembledTransaction.Errors.UserRejected

export const connectNavOracle = async (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<NavOracleApi> =>
	new NavOracleApi(clientOptions(contractId, signer, options))

export const connectIdentityVerifier = async (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<IdentityVerifierApi> =>
	new IdentityVerifierApi(clientOptions(contractId, signer, options))

export const connectShareToken = async (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<ShareTokenApi> =>
	new ShareTokenApi(clientOptions(contractId, signer, options))

export const connectAsset = async (contractId: string): Promise<AssetApi> =>
	new AssetApi(clientOptions(contractId))

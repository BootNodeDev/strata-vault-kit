import {
	AssembledTransaction,
	Client,
	type MethodOptions,
	type SignTransaction,
} from "@stellar/stellar-sdk/contract"
import { network, networkPassphrase, rpcUrl } from "./env"
import type { Client as AssetApi } from "./clients/asset/src/index"
import type {
	Client as AsyncVaultApi,
	DepositRequest,
	EpochInfo,
	EpochStatus,
	RedeemRequest,
} from "./clients/async_vault/src/index"
import type { Client as IdentityVerifierApi } from "./clients/identity_verifier/src/index"
import type {
	Client as NavOracleApi,
	NavReport,
	OracleState,
} from "./clients/nav_oracle/src/index"
import type { Client as ShareTokenApi } from "./clients/share_token/src/index"

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
})

export const connectAsyncVault = (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<AsyncVaultApi> =>
	Client.from<AsyncVaultApi>(clientOptions(contractId, signer, options))

export const isUserRejection = (error: unknown): boolean =>
	error instanceof AssembledTransaction.Errors.UserRejected

export const connectNavOracle = (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<NavOracleApi> =>
	Client.from<NavOracleApi>(clientOptions(contractId, signer, options))

export const connectIdentityVerifier = (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<IdentityVerifierApi> =>
	Client.from<IdentityVerifierApi>(clientOptions(contractId, signer, options))

export const connectShareToken = (
	contractId: string,
	signer?: Signer,
	options?: ConnectOptions,
): Promise<ShareTokenApi> =>
	Client.from<ShareTokenApi>(clientOptions(contractId, signer, options))

export const connectAsset = (contractId: string): Promise<AssetApi> =>
	Client.from<AssetApi>(clientOptions(contractId))

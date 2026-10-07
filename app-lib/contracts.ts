import {
	AssembledTransaction,
	Client,
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

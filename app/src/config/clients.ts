import {
	connectAsset,
	connectAsyncVault,
	connectIdentityVerifier,
	connectNavOracle,
	connectShareToken,
	type AssetApi,
	type AsyncVaultApi,
	type IdentityVerifierApi,
	type NavOracleApi,
	type ShareTokenApi,
	type Signer,
} from "@stellar-scaffold/app-lib"
import { addresses } from "./addresses"

let vault: Promise<AsyncVaultApi> | undefined

export const asyncVault = (): Promise<AsyncVaultApi> => {
	vault ??= connectAsyncVault(addresses.async_vault).catch((error: unknown) => {
		vault = undefined
		throw error
	})
	return vault
}

let vaultWriter:
	{ publicKey: string; client: Promise<AsyncVaultApi> } | undefined

export const asyncVaultWriter = (signer: Signer): Promise<AsyncVaultApi> => {
	if (vaultWriter?.publicKey !== signer.publicKey) {
		vaultWriter = {
			publicKey: signer.publicKey,
			client: connectAsyncVault(addresses.async_vault, signer).catch(
				(error: unknown) => {
					if (vaultWriter?.publicKey === signer.publicKey)
						vaultWriter = undefined
					throw error
				},
			),
		}
	}
	return vaultWriter.client
}

let oracle: Promise<NavOracleApi> | undefined

export const navOracle = (): Promise<NavOracleApi> => {
	oracle ??= connectNavOracle(addresses.nav_oracle).catch((error: unknown) => {
		oracle = undefined
		throw error
	})
	return oracle
}

let identityVerifierClient: Promise<IdentityVerifierApi> | undefined

export const identityVerifier = (): Promise<IdentityVerifierApi> => {
	identityVerifierClient ??= connectIdentityVerifier(
		addresses.identity_verifier,
	).catch((error: unknown) => {
		identityVerifierClient = undefined
		throw error
	})
	return identityVerifierClient
}

let shareTokenClient: Promise<ShareTokenApi> | undefined

export const shareToken = (): Promise<ShareTokenApi> => {
	shareTokenClient ??= connectShareToken(addresses.share_token).catch(
		(error: unknown) => {
			shareTokenClient = undefined
			throw error
		},
	)
	return shareTokenClient
}

let assetClient: Promise<AssetApi> | undefined

export const asset = (): Promise<AssetApi> => {
	assetClient ??= connectAsset(addresses.asset).catch((error: unknown) => {
		assetClient = undefined
		throw error
	})
	return assetClient
}

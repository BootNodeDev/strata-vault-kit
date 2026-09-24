import {
	connectAsset,
	connectAsyncVault,
	connectIdentityVerifier,
	connectNavOracle,
	connectShareToken,
	type AssetViews,
	type AsyncVaultViews,
	type IdentityVerifierViews,
	type NavOracleViews,
	type ShareTokenViews,
	type Signer,
} from "@stellar-scaffold/app-lib"
import { addresses } from "./addresses"

let vault: Promise<AsyncVaultViews> | undefined

export const asyncVault = (): Promise<AsyncVaultViews> => {
	vault ??= connectAsyncVault(addresses.async_vault).catch((error: unknown) => {
		vault = undefined
		throw error
	})
	return vault
}

let vaultWriter:
	{ publicKey: string; client: Promise<AsyncVaultViews> } | undefined

export const asyncVaultWriter = (signer: Signer): Promise<AsyncVaultViews> => {
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

let oracle: Promise<NavOracleViews> | undefined

export const navOracle = (): Promise<NavOracleViews> => {
	oracle ??= connectNavOracle(addresses.nav_oracle).catch((error: unknown) => {
		oracle = undefined
		throw error
	})
	return oracle
}

let identityVerifierClient: Promise<IdentityVerifierViews> | undefined

export const identityVerifier = (): Promise<IdentityVerifierViews> => {
	identityVerifierClient ??= connectIdentityVerifier(
		addresses.identity_verifier,
	).catch((error: unknown) => {
		identityVerifierClient = undefined
		throw error
	})
	return identityVerifierClient
}

let shareTokenClient: Promise<ShareTokenViews> | undefined

export const shareToken = (): Promise<ShareTokenViews> => {
	shareTokenClient ??= connectShareToken(addresses.share_token).catch(
		(error: unknown) => {
			shareTokenClient = undefined
			throw error
		},
	)
	return shareTokenClient
}

let assetClient: Promise<AssetViews> | undefined

export const asset = (): Promise<AssetViews> => {
	assetClient ??= connectAsset(addresses.asset).catch((error: unknown) => {
		assetClient = undefined
		throw error
	})
	return assetClient
}

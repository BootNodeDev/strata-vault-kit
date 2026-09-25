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

interface VaultWriterEntry {
	signer: Signer
	client: Promise<AsyncVaultApi>
}

let vaultWriter: VaultWriterEntry | undefined

const sameSigner = (a: Signer, b: Signer) =>
	a.publicKey === b.publicKey && a.signTransaction === b.signTransaction

export const asyncVaultWriter = (signer: Signer): Promise<AsyncVaultApi> => {
	if (!vaultWriter || !sameSigner(vaultWriter.signer, signer)) {
		const entry: VaultWriterEntry = {
			signer,
			client: connectAsyncVault(addresses.async_vault, signer).catch(
				(error: unknown) => {
					if (vaultWriter === entry) vaultWriter = undefined
					throw error
				},
			),
		}
		vaultWriter = entry
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

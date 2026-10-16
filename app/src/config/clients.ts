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

interface WriterEntry<T> {
	signer: Signer
	client: Promise<T>
}

const sameSigner = (a: Signer, b: Signer) =>
	a.publicKey === b.publicKey && a.signTransaction === b.signTransaction

const writer = <T>(connect: (signer: Signer) => Promise<T>) => {
	let current: WriterEntry<T> | undefined
	return (signer: Signer): Promise<T> => {
		if (!current || !sameSigner(current.signer, signer)) {
			const entry: WriterEntry<T> = {
				signer,
				client: connect(signer).catch((error: unknown) => {
					if (current === entry) current = undefined
					throw error
				}),
			}
			current = entry
		}
		return current.client
	}
}

export const asyncVaultWriter = writer((signer) =>
	connectAsyncVault(addresses.async_vault, signer),
)

export const navOracleWriter = writer((signer) =>
	connectNavOracle(addresses.nav_oracle, signer),
)

export const shareTokenWriter = writer((signer) =>
	connectShareToken(addresses.share_token, signer),
)

const verifierWriters = new Map<
	string,
	(signer: Signer) => Promise<IdentityVerifierApi>
>()

export const identityVerifierWriter = (address: string) => {
	let verifierWriter = verifierWriters.get(address)
	if (verifierWriter === undefined) {
		verifierWriter = writer((signer) =>
			connectIdentityVerifier(address, signer),
		)
		verifierWriters.set(address, verifierWriter)
	}
	return verifierWriter
}

let oracle: Promise<NavOracleApi> | undefined

export const navOracle = (): Promise<NavOracleApi> => {
	oracle ??= connectNavOracle(addresses.nav_oracle).catch((error: unknown) => {
		oracle = undefined
		throw error
	})
	return oracle
}

const verifierReaders = new Map<string, Promise<IdentityVerifierApi>>()

export const identityVerifierAt = (
	address: string,
): Promise<IdentityVerifierApi> => {
	const cached = verifierReaders.get(address)
	if (cached !== undefined) return cached
	const client = connectIdentityVerifier(address).catch((error: unknown) => {
		verifierReaders.delete(address)
		throw error
	})
	verifierReaders.set(address, client)
	return client
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

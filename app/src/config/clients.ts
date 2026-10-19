import {
	connectAsset,
	connectAsyncVault,
	connectIdentityVerifier,
	connectNavOracle,
	connectShareToken,
	type AssetApi,
	type AsyncVaultApi,
	type ConnectOptions,
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

export type WriterSigner = Signer & { timeoutInSeconds?: number }

interface WriterEntry<T> {
	signer: WriterSigner
	client: Promise<T>
}

const sameSigner = (a: WriterSigner, b: WriterSigner) =>
	a.publicKey === b.publicKey &&
	a.signTransaction === b.signTransaction &&
	a.timeoutInSeconds === b.timeoutInSeconds

const writer = <T>(
	connect: (signer: Signer, options: ConnectOptions) => Promise<T>,
) => {
	let current: WriterEntry<T> | undefined
	return (signer: WriterSigner): Promise<T> => {
		if (!current || !sameSigner(current.signer, signer)) {
			const { timeoutInSeconds } = signer
			const entry: WriterEntry<T> = {
				signer,
				client: connect(signer, { timeoutInSeconds }).catch(
					(error: unknown) => {
						if (current === entry) current = undefined
						throw error
					},
				),
			}
			current = entry
		}
		return current.client
	}
}

export const asyncVaultWriter = writer((signer, options) =>
	connectAsyncVault(addresses.async_vault, signer, options),
)

export const navOracleWriter = writer((signer, options) =>
	connectNavOracle(addresses.nav_oracle, signer, options),
)

export const shareTokenWriter = writer((signer, options) =>
	connectShareToken(addresses.share_token, signer, options),
)

const verifierWriters = new Map<
	string,
	(signer: Signer) => Promise<IdentityVerifierApi>
>()

export const identityVerifierWriter = (address: string) => {
	let verifierWriter = verifierWriters.get(address)
	if (verifierWriter === undefined) {
		verifierWriter = writer((signer, options) =>
			connectIdentityVerifier(address, signer, options),
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

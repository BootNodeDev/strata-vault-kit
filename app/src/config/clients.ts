import {
	connectAsyncVault,
	connectIdentityVerifier,
	connectNavOracle,
	type AsyncVaultViews,
	type IdentityVerifierViews,
	type NavOracleViews,
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

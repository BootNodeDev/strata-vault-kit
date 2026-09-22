import {
	connectAsyncVault,
	type AsyncVaultViews,
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

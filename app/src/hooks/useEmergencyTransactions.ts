import { type Signer } from "@stellar-scaffold/app-lib"
import {
	asyncVaultWriter,
	navOracleWriter,
	shareTokenWriter,
} from "../config/clients"
import { adminTransaction } from "./useAdminTransaction"
import { oracleWriteKeys } from "./useOracleState"
import { tokenPausedKey } from "./useTokenPaused"
import { vaultPausedKey } from "./useVaultPaused"

const vaultCall = (method: "pause" | "unpause") => (signer: Signer) =>
	asyncVaultWriter(signer).then((vault) =>
		vault[method]({ caller: signer.publicKey }),
	)

const tokenCall = (method: "pause" | "unpause") => (signer: Signer) =>
	shareTokenWriter(signer).then((token) =>
		token[method]({ caller: signer.publicKey }),
	)

const pauseNavCall = (signer: Signer) =>
	navOracleWriter(signer).then((oracle) =>
		oracle.pause_nav({ caller: signer.publicKey }),
	)

const clearLatestCall = (signer: Signer) =>
	navOracleWriter(signer).then((oracle) => oracle.clear_latest())

const setNavPausedCall = (signer: Signer, paused: boolean) =>
	navOracleWriter(signer).then((oracle) => oracle.set_nav_paused({ paused }))

export const usePauseVault = adminTransaction(vaultCall("pause"), [
	vaultPausedKey,
])
export const useUnpauseVault = adminTransaction(vaultCall("unpause"), [
	vaultPausedKey,
])
export const usePauseToken = adminTransaction(tokenCall("pause"), [
	tokenPausedKey,
])
export const useUnpauseToken = adminTransaction(tokenCall("unpause"), [
	tokenPausedKey,
])
export const usePauseNav = adminTransaction(pauseNavCall, oracleWriteKeys)
export const useClearLatest = adminTransaction(clearLatestCall, oracleWriteKeys)
export const useSetNavPaused = adminTransaction(
	setNavPausedCall,
	oracleWriteKeys,
)

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

const oracleCall = (method: "pause_nav" | "clear_latest") => (signer: Signer) =>
	navOracleWriter(signer).then((oracle) =>
		oracle[method]({ caller: signer.publicKey }),
	)

const setNavPausedCall = (signer: Signer, paused: boolean) =>
	navOracleWriter(signer).then((oracle) =>
		oracle.set_nav_paused({ paused, caller: signer.publicKey }),
	)

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
export const usePauseNav = adminTransaction(
	oracleCall("pause_nav"),
	oracleWriteKeys,
)
export const useClearLatest = adminTransaction(
	oracleCall("clear_latest"),
	oracleWriteKeys,
)
export const useSetNavPaused = adminTransaction(
	setNavPausedCall,
	oracleWriteKeys,
)

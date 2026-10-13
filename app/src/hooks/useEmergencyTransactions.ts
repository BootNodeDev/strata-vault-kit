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

const oracleCall =
	(method: "raise_ripcord" | "clear_latest") => (signer: Signer) =>
		navOracleWriter(signer).then((oracle) =>
			oracle[method]({ caller: signer.publicKey }),
		)

const setRipcordCall = (signer: Signer, paused: boolean) =>
	navOracleWriter(signer).then((oracle) =>
		oracle.set_ripcord({ paused, caller: signer.publicKey }),
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
export const useRaiseRipcord = adminTransaction(
	oracleCall("raise_ripcord"),
	oracleWriteKeys,
)
export const useClearLatest = adminTransaction(
	oracleCall("clear_latest"),
	oracleWriteKeys,
)
export const useSetRipcord = adminTransaction(setRipcordCall, oracleWriteKeys)

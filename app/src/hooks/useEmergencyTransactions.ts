import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { type Signer } from "@stellar-scaffold/app-lib"
import { type QueryKey } from "@tanstack/react-query"
import {
	asyncVaultWriter,
	navOracleWriter,
	shareTokenWriter,
} from "../config/clients"
import {
	useContractTransaction,
	type UseContractTransaction,
} from "./useContractTransaction"
import { oracleWriteKeys } from "./useOracleState"
import { tokenPausedKey } from "./useTokenPaused"
import { vaultPausedKey } from "./useVaultPaused"

type NoResult = Record<never, never>

const toConfirmed = () => ({})

const emergencyTransaction =
	<TArg = void>(
		call: (signer: Signer, arg: TArg) => Promise<AssembledTransaction<void>>,
		keys: readonly QueryKey[],
	) =>
	(): UseContractTransaction<TArg, NoResult> =>
		useContractTransaction<TArg, void, NoResult>(call, toConfirmed, keys)

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

export const usePauseVault = emergencyTransaction(vaultCall("pause"), [
	vaultPausedKey,
])
export const useUnpauseVault = emergencyTransaction(vaultCall("unpause"), [
	vaultPausedKey,
])
export const usePauseToken = emergencyTransaction(tokenCall("pause"), [
	tokenPausedKey,
])
export const useUnpauseToken = emergencyTransaction(tokenCall("unpause"), [
	tokenPausedKey,
])
export const useRaiseRipcord = emergencyTransaction(
	oracleCall("raise_ripcord"),
	oracleWriteKeys,
)
export const useClearLatest = emergencyTransaction(
	oracleCall("clear_latest"),
	oracleWriteKeys,
)
export const useSetRipcord = emergencyTransaction(
	setRipcordCall,
	oracleWriteKeys,
)

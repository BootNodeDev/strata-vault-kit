import { type Signer } from "@stellar-scaffold/app-lib"
import { asyncVaultWriter } from "../config/clients"
import {
	useContractTransaction,
	type UseContractTransaction,
} from "./useContractTransaction"
import { vaultPausedKey } from "./useVaultPaused"

const WRITE_KEYS = [vaultPausedKey]

const call = (signer: Signer) =>
	asyncVaultWriter(signer).then((vault) =>
		vault.unpause({ caller: signer.publicKey }),
	)

const toConfirmed = () => ({})

export function useUnpauseVault(): UseContractTransaction<
	void,
	Record<never, never>
> {
	return useContractTransaction<void, void, Record<never, never>>(
		call,
		toConfirmed,
		WRITE_KEYS,
	)
}

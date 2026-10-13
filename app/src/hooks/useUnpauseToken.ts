import { type Signer } from "@stellar-scaffold/app-lib"
import { shareTokenWriter } from "../config/clients"
import {
	useContractTransaction,
	type UseContractTransaction,
} from "./useContractTransaction"
import { tokenPausedKey } from "./useTokenPaused"

const WRITE_KEYS = [tokenPausedKey]

const call = (signer: Signer) =>
	shareTokenWriter(signer).then((token) =>
		token.unpause({ caller: signer.publicKey }),
	)

const toConfirmed = () => ({})

export function useUnpauseToken(): UseContractTransaction<
	void,
	Record<never, never>
> {
	return useContractTransaction<void, void, Record<never, never>>(
		call,
		toConfirmed,
		WRITE_KEYS,
	)
}

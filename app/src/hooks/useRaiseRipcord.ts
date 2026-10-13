import { type Signer } from "@stellar-scaffold/app-lib"
import { navOracleWriter } from "../config/clients"
import {
	useContractTransaction,
	type UseContractTransaction,
} from "./useContractTransaction"
import { oracleWriteKeys } from "./useOracleState"

const call = (signer: Signer) =>
	navOracleWriter(signer).then((oracle) =>
		oracle.raise_ripcord({ caller: signer.publicKey }),
	)

const toConfirmed = () => ({})

export function useRaiseRipcord(): UseContractTransaction<
	void,
	Record<never, never>
> {
	return useContractTransaction<void, void, Record<never, never>>(
		call,
		toConfirmed,
		oracleWriteKeys,
	)
}

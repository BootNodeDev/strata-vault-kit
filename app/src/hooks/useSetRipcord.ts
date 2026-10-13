import { type Signer } from "@stellar-scaffold/app-lib"
import { navOracleWriter } from "../config/clients"
import {
	useContractTransaction,
	type UseContractTransaction,
} from "./useContractTransaction"
import { oracleWriteKeys } from "./useOracleState"

const call = (signer: Signer, paused: boolean) =>
	navOracleWriter(signer).then((oracle) =>
		oracle.set_ripcord({ paused, caller: signer.publicKey }),
	)

const toConfirmed = () => ({})

export function useSetRipcord(): UseContractTransaction<
	boolean,
	Record<never, never>
> {
	return useContractTransaction<boolean, void, Record<never, never>>(
		call,
		toConfirmed,
		oracleWriteKeys,
	)
}

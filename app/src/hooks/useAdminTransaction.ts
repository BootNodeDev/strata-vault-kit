import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { type Signer } from "@stellar-scaffold/app-lib"
import { type QueryKey } from "@tanstack/react-query"
import {
	useContractTransaction,
	type UseContractTransaction,
} from "./useContractTransaction"

type NoResult = Record<never, never>

const toConfirmed = () => ({})

export const adminTransaction =
	<TArg = void, TResult = void>(
		call: (signer: Signer, arg: TArg) => Promise<AssembledTransaction<TResult>>,
		keys: readonly QueryKey[],
	) =>
	(): UseContractTransaction<TArg, NoResult> =>
		useContractTransaction<TArg, TResult, NoResult>(call, toConfirmed, keys)

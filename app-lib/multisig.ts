import {
	Address,
	FeeBumpTransaction,
	Keypair,
	type Operation,
	scValToNative,
	StrKey,
	type Transaction,
	TransactionBuilder,
	type xdr,
} from "@stellar/stellar-sdk"
import {
	type AssembledTransaction,
	type ClientOptions,
} from "@stellar/stellar-sdk/contract"
import { Api } from "@stellar/stellar-sdk/rpc"
import type { AccountSigners } from "./accounts"
import { networkPassphrase } from "./env"
import { parseErrorCode } from "./readContract"
import { server } from "./rpc"

export const OPERATOR_TIMEOUT_SECONDS = 7 * 24 * 60 * 60

const LEDGER_SECONDS = 5

export const AUTHORIZATION_LEDGERS = OPERATOR_TIMEOUT_SECONDS / LEDGER_SECONDS

const CO_SIGNED_FUNCTION = "legal_transfer"

export class InvalidPendingTransaction extends Error {
	constructor(reason: string) {
		super(reason)
		this.name = "InvalidPendingTransaction"
	}
}

export interface PendingAuthorization {
	address: string
	signed: boolean
	expirationLedger: number
}

export interface PendingTransaction {
	transaction: Transaction
	source: string
	sequence: string
	expiresAt: Date | null
	contractId: string
	fn: string
	args: unknown[]
	hash: string
	authorization: PendingAuthorization | null
}

export type SignAuthEntry = NonNullable<ClientOptions["signAuthEntry"]>

export type CoSignStep =
	| { kind: "ready"; xdr: string; pending: PendingTransaction }
	| { kind: "refused"; code: number }

export type SubmitFailure =
	| "sequence-consumed"
	| "expired"
	| "bad-auth"
	| "fee"
	| "fee-too-low"
	| "not-accepted"
	| "unknown"

export type SubmitResult =
	| {
			status: "success"
			hash: string
			result: unknown
			events: xdr.ContractEvent[][]
	  }
	| { status: "failed"; reason: SubmitFailure; hash: string }

const parseEnvelope = (encoded: string) => {
	try {
		return TransactionBuilder.fromXDR(encoded, networkPassphrase)
	} catch {
		throw new InvalidPendingTransaction("not a transaction envelope")
	}
}

const unexpectedEntry = () =>
	new InvalidPendingTransaction("unexpected authorization entry")

const hostFunctionOf = (transaction: Transaction) => {
	const [operation, ...rest] = transaction.operations
	if (operation === undefined || rest.length > 0) {
		throw new InvalidPendingTransaction("expected exactly one operation")
	}
	if (operation.type !== "invokeHostFunction") {
		throw new InvalidPendingTransaction("not a host function invocation")
	}
	if (
		operation.source !== undefined &&
		operation.source !== transaction.source
	) {
		throw new InvalidPendingTransaction("operation source differs")
	}
	if (operation.func.switch().name !== "hostFunctionTypeInvokeContract") {
		throw new InvalidPendingTransaction("not a contract invocation")
	}
	return operation
}

const addressEntriesOf = (operation: Operation.InvokeHostFunction) =>
	(operation.auth ?? []).filter((entry) => {
		const kind = entry.credentials().switch().name
		if (kind === "sorobanCredentialsSourceAccount") return false
		if (kind === "sorobanCredentialsAddress") return true
		throw unexpectedEntry()
	})

const authorizes = (
	entry: xdr.SorobanAuthorizationEntry,
	invocation: xdr.InvokeContractArgs,
): boolean => {
	const root = entry.rootInvocation()
	const fn = root.function()
	return (
		root.subInvocations().length === 0 &&
		fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn" &&
		fn.contractFn().toXDR("base64") === invocation.toXDR("base64")
	)
}

const authorizationOf = (
	operation: Operation.InvokeHostFunction,
	invocation: xdr.InvokeContractArgs,
): PendingAuthorization | null => {
	const [entry, ...others] = addressEntriesOf(operation)
	if (entry === undefined) return null
	if (others.length > 0) throw unexpectedEntry()
	if (invocation.functionName().toString() !== CO_SIGNED_FUNCTION)
		throw unexpectedEntry()
	if (!authorizes(entry, invocation)) throw unexpectedEntry()
	const credentials = entry.credentials().address()
	const address = Address.fromScAddress(credentials.address()).toString()
	if (!StrKey.isValidEd25519PublicKey(address)) throw unexpectedEntry()
	return {
		address,
		signed: credentials.signature().switch().name !== "scvVoid",
		expirationLedger: credentials.signatureExpirationLedger(),
	}
}

const expiryOf = (transaction: Transaction): Date | null => {
	const maxTime = transaction.timeBounds?.maxTime
	if (maxTime === undefined || maxTime === "0") return null
	return new Date(Number(maxTime) * 1000)
}

const assertStarted = (transaction: Transaction) => {
	const minTime = transaction.timeBounds?.minTime
	if (minTime !== undefined && Number(minTime) > Date.now() / 1000) {
		throw new InvalidPendingTransaction("not valid yet")
	}
}

export function decodePending(encoded: string): PendingTransaction {
	const transaction = parseEnvelope(encoded)
	if (transaction instanceof FeeBumpTransaction) {
		throw new InvalidPendingTransaction("fee bump envelope")
	}
	assertStarted(transaction)
	const operation = hostFunctionOf(transaction)
	const invocation = operation.func.invokeContract()
	return {
		transaction,
		source: transaction.source,
		sequence: transaction.sequence,
		expiresAt: expiryOf(transaction),
		contractId: Address.fromScAddress(invocation.contractAddress()).toString(),
		fn: invocation.functionName().toString(),
		args: invocation.args().map(scValToNative),
		hash: transaction.hash().toString("hex"),
		authorization: authorizationOf(operation, invocation),
	}
}

const encodeEnvelope = (transaction: Transaction) =>
	transaction.toEnvelope().toXDR("base64")

const credentialOf = (entry: xdr.SorobanAuthorizationEntry): string => {
	const credentials = entry.credentials()
	if (credentials.switch().name !== "sorobanCredentialsAddress")
		return credentials.toXDR("base64")
	const address = credentials.address()
	return `${Address.fromScAddress(address.address()).toString()}:${address.nonce().toString()}`
}

const intentOf = (transaction: Transaction): string => {
	const operation = hostFunctionOf(transaction)
	const entries = (operation.auth ?? []).map(
		(entry) =>
			`${credentialOf(entry)}/${entry.rootInvocation().toXDR("base64")}`,
	)
	return [
		transaction.source,
		transaction.sequence,
		operation.func.toXDR("base64"),
		...entries,
	].join("|")
}

const authEntriesOf = (transaction: Transaction): string =>
	(hostFunctionOf(transaction).auth ?? [])
		.map((entry) => entry.toXDR("base64"))
		.join("|")

const sameTimeBounds = (a: Transaction, b: Transaction): boolean =>
	a.timeBounds?.minTime === b.timeBounds?.minTime &&
	a.timeBounds?.maxTime === b.timeBounds?.maxTime

const simulated = async (
	assembled: AssembledTransaction<unknown>,
): Promise<Transaction | number> => {
	await assembled.simulate()
	const code = parseErrorCode(assembled.simulation)
	if (code !== null) return code
	if (
		assembled.simulation === undefined ||
		!Api.isSimulationSuccess(assembled.simulation) ||
		assembled.built === undefined
	) {
		throw new Error("The transaction could not be simulated")
	}
	return assembled.built
}

export async function latestLedger(): Promise<number> {
	return (await server.getLatestLedger()).sequence
}

/** Re-simulates after signing so the fee covers the signature check. */
export async function authorizePending(
	assembled: AssembledTransaction<unknown>,
	pending: PendingTransaction,
	signAuthEntry: SignAuthEntry,
): Promise<CoSignStep> {
	const { authorization } = pending
	if (authorization === null || authorization.signed) {
		throw new InvalidPendingTransaction("nothing to authorize")
	}
	const expiration = (await latestLedger()) + AUTHORIZATION_LEDGERS
	await assembled.signAuthEntries({
		address: authorization.address,
		signAuthEntry,
		expiration,
	})
	const built = await simulated(assembled)
	if (typeof built === "number") return { kind: "refused", code: built }
	const xdr = encodeEnvelope(built)
	const next = decodePending(xdr)
	if (
		next.authorization?.signed !== true ||
		next.authorization.address !== authorization.address ||
		intentOf(next.transaction) !== intentOf(pending.transaction) ||
		!sameTimeBounds(next.transaction, pending.transaction)
	) {
		throw new InvalidPendingTransaction("authorization changed the transaction")
	}
	return { kind: "ready", xdr, pending: next }
}

/** Restarts the timeout here: nobody could sign the envelope before the admin did. */
export async function prepareCoSigned(
	assembled: AssembledTransaction<unknown>,
	pending: PendingTransaction,
): Promise<CoSignStep> {
	if (pending.authorization?.signed !== true) {
		throw new InvalidPendingTransaction("authorization missing")
	}
	const built = await simulated(assembled)
	if (typeof built === "number") return { kind: "refused", code: built }
	const retimed = TransactionBuilder.cloneFrom(built, {
		timebounds: undefined,
		sorobanData: assembled.simulationData.transactionData,
	})
		.setTimeout(OPERATOR_TIMEOUT_SECONDS)
		.build()
	const xdr = encodeEnvelope(retimed)
	const next = decodePending(xdr)
	if (authEntriesOf(next.transaction) !== authEntriesOf(pending.transaction)) {
		throw new InvalidPendingTransaction("simulation changed the authorization")
	}
	if (intentOf(next.transaction) !== intentOf(pending.transaction)) {
		throw new InvalidPendingTransaction("simulation changed the transaction")
	}
	return { kind: "ready", xdr, pending: next }
}

const verifiedSigners = (transaction: Transaction, keys: string[]) => {
	const hash = transaction.hash()
	const signed = new Set<string>()
	for (const signature of transaction.signatures) {
		const key = keys.find((candidate) => {
			const keypair = Keypair.fromPublicKey(candidate)
			return (
				keypair.signatureHint().equals(signature.hint()) &&
				keypair.verify(hash, signature.signature())
			)
		})
		if (key !== undefined) signed.add(key)
	}
	return [...signed]
}

export function signatureWeight(
	transaction: Transaction,
	signers: AccountSigners,
): { signedBy: string[]; weight: number } {
	const signedBy = verifiedSigners(
		transaction,
		signers.signers.map(({ key }) => key),
	)
	const weight = signers.signers
		.filter(({ key }) => signedBy.includes(key))
		.reduce((sum, { weight }) => sum + weight, 0)
	return { signedBy, weight }
}

export const hasSigned = (
	transaction: Transaction,
	publicKey: string,
): boolean => verifiedSigners(transaction, [publicKey]).length > 0

const failureOf = (result: xdr.TransactionResult): SubmitFailure => {
	switch (result.result().switch().name) {
		case "txBadSeq":
			return "sequence-consumed"
		case "txTooLate":
			return "expired"
		case "txBadAuth":
		case "txBadAuthExtra":
			return "bad-auth"
		case "txInsufficientFee":
			return "fee-too-low"
		case "txInsufficientBalance":
			return "fee"
		default:
			return "unknown"
	}
}

export async function submitSigned(
	transaction: Transaction,
): Promise<SubmitResult> {
	const sent = await server.sendTransaction(transaction)
	const hash = sent.hash
	if (sent.status === "TRY_AGAIN_LATER") {
		return { status: "failed", reason: "not-accepted", hash }
	}
	if (sent.status === "ERROR") {
		const reason = sent.errorResult ? failureOf(sent.errorResult) : "unknown"
		return { status: "failed", reason, hash }
	}
	const polled = await server.pollTransaction(hash)
	if (polled.status === Api.GetTransactionStatus.SUCCESS) {
		const result =
			polled.returnValue === undefined
				? undefined
				: scValToNative(polled.returnValue)
		return {
			status: "success",
			hash,
			result,
			events: polled.events.contractEventsXdr,
		}
	}
	if (polled.status === Api.GetTransactionStatus.FAILED) {
		return { status: "failed", reason: failureOf(polled.resultXdr), hash }
	}
	return { status: "failed", reason: "unknown", hash }
}

export async function transactionStatus(
	hash: string,
): Promise<"success" | "failed" | "not-found"> {
	const found = await server.getTransaction(hash)
	switch (found.status) {
		case Api.GetTransactionStatus.SUCCESS:
			return "success"
		case Api.GetTransactionStatus.FAILED:
			return "failed"
		case Api.GetTransactionStatus.NOT_FOUND:
			return "not-found"
	}
}

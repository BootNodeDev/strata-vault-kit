import {
	Address,
	FeeBumpTransaction,
	Keypair,
	scValToNative,
	type Transaction,
	TransactionBuilder,
	type xdr,
} from "@stellar/stellar-sdk"
import { Api, Server } from "@stellar/stellar-sdk/rpc"
import type { AccountSigners } from "./accounts"
import { networkPassphrase, rpcUrl, stellarNetwork } from "./env"

export const OPERATOR_TIMEOUT_SECONDS = 7 * 24 * 60 * 60

export class InvalidPendingTransaction extends Error {
	constructor(reason: string) {
		super(reason)
		this.name = "InvalidPendingTransaction"
	}
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
}

export type SubmitFailure =
	"sequence-consumed" | "expired" | "bad-auth" | "fee" | "unknown"

export type SubmitResult =
	| { status: "success"; hash: string; result: unknown }
	| { status: "failed"; reason: SubmitFailure; hash: string }

const server = new Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })

const parseEnvelope = (encoded: string) => {
	try {
		return TransactionBuilder.fromXDR(encoded, networkPassphrase)
	} catch {
		throw new InvalidPendingTransaction("not a transaction envelope")
	}
}

const invocationOf = (transaction: Transaction) => {
	const [operation, ...rest] = transaction.operations
	if (operation === undefined || rest.length > 0) {
		throw new InvalidPendingTransaction("expected exactly one operation")
	}
	if (operation.type !== "invokeHostFunction") {
		throw new InvalidPendingTransaction("not a host function invocation")
	}
	if (operation.func.switch().name !== "hostFunctionTypeInvokeContract") {
		throw new InvalidPendingTransaction("not a contract invocation")
	}
	return operation.func.invokeContract()
}

const expiryOf = (transaction: Transaction): Date | null => {
	const maxTime = transaction.timeBounds?.maxTime
	if (maxTime === undefined || maxTime === "0") return null
	return new Date(Number(maxTime) * 1000)
}

export function decodePending(encoded: string): PendingTransaction {
	const transaction = parseEnvelope(encoded)
	if (transaction instanceof FeeBumpTransaction) {
		throw new InvalidPendingTransaction("fee bump envelope")
	}
	const invocation = invocationOf(transaction)
	return {
		transaction,
		source: transaction.source,
		sequence: transaction.sequence,
		expiresAt: expiryOf(transaction),
		contractId: Address.fromScAddress(invocation.contractAddress()).toString(),
		fn: invocation.functionName().toString(),
		args: invocation.args().map(scValToNative),
		hash: transaction.hash().toString("hex"),
	}
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
		return { status: "success", hash, result }
	}
	if (polled.status === Api.GetTransactionStatus.FAILED) {
		return { status: "failed", reason: failureOf(polled.resultXdr), hash }
	}
	return { status: "failed", reason: "unknown", hash }
}

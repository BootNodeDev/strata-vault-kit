import {
	Account,
	Address,
	BASE_FEE,
	Keypair,
	nativeToScVal,
	Operation,
	StrKey,
	TimeoutInfinite,
	type Transaction,
	TransactionBuilder,
	xdr,
} from "@stellar/stellar-sdk"
import { Api } from "@stellar/stellar-sdk/rpc"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { connectAsyncVault } from "./contracts"
import { networkPassphrase } from "./env"
import {
	decodePending,
	hasSigned,
	InvalidPendingTransaction,
	OPERATOR_TIMEOUT_SECONDS,
	signatureWeight,
	submitSigned,
} from "./multisig"

const { sendMock, pollMock, fromMock } = vi.hoisted(() => ({
	sendMock: vi.fn(),
	pollMock: vi.fn(),
	fromMock: vi.fn(),
}))

vi.mock("@stellar/stellar-sdk/rpc", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@stellar/stellar-sdk/rpc")>()
	class MockServer {
		sendTransaction = sendMock
		pollTransaction = pollMock
	}
	return { ...actual, Server: MockServer }
})

vi.mock("@stellar/stellar-sdk/contract", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@stellar/stellar-sdk/contract")>()
	return { ...actual, Client: { from: fromMock } }
})

const authority = Keypair.random()
const signerOne = Keypair.random()
const signerTwo = Keypair.random()
const outsider = Keypair.random()
const contractId = StrKey.encodeContract(Keypair.random().rawPublicKey())
const recipient = Keypair.random().publicKey()
const maxTime = 1_800_000_000

const builder = (timebounds = { minTime: 0, maxTime }) =>
	new TransactionBuilder(new Account(authority.publicKey(), "41"), {
		fee: BASE_FEE,
		networkPassphrase,
		timebounds,
	})

const invokeOp = () =>
	Operation.invokeContractFunction({
		contract: contractId,
		function: "set_nav",
		args: [
			nativeToScVal(42n, { type: "i128" }),
			new Address(recipient).toScVal(),
		],
	})

const pendingTransaction = () => builder().addOperation(invokeOp()).build()

const signedBy = (...keypairs: Keypair[]) => {
	const tx = pendingTransaction()
	tx.sign(...keypairs)
	return tx
}

const signers = {
	signers: [
		{ key: signerOne.publicKey(), weight: 1 },
		{ key: signerTwo.publicKey(), weight: 2 },
	],
	thresholds: { low: 1, med: 3, high: 3 },
}

const resultArm = (code: string) =>
	code === "txFailed"
		? xdr.TransactionResultResult.txFailed([])
		: (
				xdr.TransactionResultResult as unknown as Record<
					string,
					() => xdr.TransactionResultResult
				>
			)[code]!()

const transactionResult = (code: string) =>
	new xdr.TransactionResult({
		feeCharged: xdr.Int64.fromString("100"),
		result: resultArm(code),
		ext: new xdr.TransactionResultExt(0),
	})

const sent = (
	overrides: Partial<Api.SendTransactionResponse> = {},
): Api.SendTransactionResponse => ({
	status: "PENDING",
	hash: "abc123",
	latestLedger: 10,
	latestLedgerCloseTime: 1_700_000_000,
	...overrides,
})

const polled = (
	status: Api.GetTransactionStatus.SUCCESS | Api.GetTransactionStatus.FAILED,
	resultXdr: xdr.TransactionResult,
	tx: Transaction,
): Api.GetTransactionResponse => ({
	status,
	txHash: "abc123",
	latestLedger: 11,
	latestLedgerCloseTime: 1_700_000_005,
	oldestLedger: 1,
	oldestLedgerCloseTime: 1_600_000_000,
	ledger: 11,
	createdAt: 1_700_000_005,
	applicationOrder: 1,
	feeBump: false,
	envelopeXdr: tx.toEnvelope(),
	resultXdr,
	resultMetaXdr: new xdr.TransactionMeta(
		3,
		new xdr.TransactionMetaV3({
			ext: new xdr.ExtensionPoint(0),
			txChangesBefore: [],
			operations: [],
			txChangesAfter: [],
			sorobanMeta: null,
		}),
	),
	events: { transactionEventsXdr: [], contractEventsXdr: [] },
})

const notFound = (): Api.GetMissingTransactionResponse => ({
	status: Api.GetTransactionStatus.NOT_FOUND,
	txHash: "abc123",
	latestLedger: 11,
	latestLedgerCloseTime: 1_700_000_005,
	oldestLedger: 1,
	oldestLedgerCloseTime: 1_600_000_000,
})

describe("decodePending", () => {
	it("reads the source, sequence, expiry, contract, function, args and hash", () => {
		const tx = pendingTransaction()

		const pending = decodePending(tx.toEnvelope().toXDR("base64"))

		expect(pending.source).toBe(authority.publicKey())
		expect(pending.sequence).toBe("42")
		expect(pending.expiresAt).toEqual(new Date(maxTime * 1000))
		expect(pending.contractId).toBe(contractId)
		expect(pending.fn).toBe("set_nav")
		expect(pending.args).toEqual([42n, recipient])
		expect(pending.hash).toBe(tx.hash().toString("hex"))
		expect(pending.transaction.hash()).toEqual(tx.hash())
	})

	it("has no expiry when the transaction never times out", () => {
		const tx = builder({ minTime: 0, maxTime: TimeoutInfinite })
			.addOperation(invokeOp())
			.build()

		expect(decodePending(tx.toEnvelope().toXDR("base64")).expiresAt).toBeNull()
	})

	it("refuses input that is not a transaction envelope", () => {
		expect(() => decodePending("not an envelope")).toThrow(
			InvalidPendingTransaction,
		)
	})

	it("refuses a fee bump envelope", () => {
		const inner = signedBy(authority)
		const bump = TransactionBuilder.buildFeeBumpTransaction(
			outsider,
			"1000",
			inner,
			networkPassphrase,
		)

		expect(() => decodePending(bump.toEnvelope().toXDR("base64"))).toThrow(
			InvalidPendingTransaction,
		)
	})

	it("refuses a transaction with more than one operation", () => {
		const tx = builder()
			.addOperation(invokeOp())
			.addOperation(invokeOp())
			.build()

		expect(() => decodePending(tx.toEnvelope().toXDR("base64"))).toThrow(
			InvalidPendingTransaction,
		)
	})

	it("refuses an operation that is not a host function invocation", () => {
		const tx = builder()
			.addOperation(Operation.manageData({ name: "k", value: "v" }))
			.build()

		expect(() => decodePending(tx.toEnvelope().toXDR("base64"))).toThrow(
			InvalidPendingTransaction,
		)
	})

	it("refuses a host function that is not a contract invocation", () => {
		const tx = builder()
			.addOperation(Operation.uploadContractWasm({ wasm: new Uint8Array(8) }))
			.build()

		expect(() => decodePending(tx.toEnvelope().toXDR("base64"))).toThrow(
			InvalidPendingTransaction,
		)
	})
})

describe("signatureWeight", () => {
	it("sums the weight of the signers whose signatures verify", () => {
		expect(signatureWeight(signedBy(signerOne, signerTwo), signers)).toEqual({
			signedBy: [signerOne.publicKey(), signerTwo.publicKey()],
			weight: 3,
		})
	})

	it("counts nothing when no one has signed", () => {
		expect(signatureWeight(pendingTransaction(), signers)).toEqual({
			signedBy: [],
			weight: 0,
		})
	})

	it("ignores a signature from a key that is not a signer", () => {
		expect(signatureWeight(signedBy(outsider, signerOne), signers)).toEqual({
			signedBy: [signerOne.publicKey()],
			weight: 1,
		})
	})

	it("ignores a signature whose hint matches but does not verify", () => {
		const tx = pendingTransaction()
		const other = signedBy(signerTwo)
		tx.signatures.push(other.signatures[0]!)
		tx.sign(signerOne)
		tx.signatures.push(
			new xdr.DecoratedSignature({
				hint: signerTwo.signatureHint(),
				signature: outsider.sign(tx.hash()),
			}),
		)

		expect(signatureWeight(tx, signers)).toEqual({
			signedBy: [signerTwo.publicKey(), signerOne.publicKey()],
			weight: 3,
		})
	})
})

describe("hasSigned", () => {
	it("is true for a key whose signature is on the envelope", () => {
		expect(hasSigned(signedBy(signerOne), signerOne.publicKey())).toBe(true)
	})

	it("is false for a key that has not signed", () => {
		expect(hasSigned(signedBy(signerOne), signerTwo.publicKey())).toBe(false)
	})
})

describe("submitSigned", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns success with the hash once the transaction is applied", async () => {
		const tx = signedBy(signerOne, signerTwo)
		sendMock.mockResolvedValue(sent())
		pollMock.mockResolvedValue(
			polled(
				Api.GetTransactionStatus.SUCCESS,
				transactionResult("txSuccess"),
				tx,
			),
		)

		await expect(submitSigned(tx)).resolves.toEqual({
			status: "success",
			hash: "abc123",
		})
		expect(sendMock).toHaveBeenCalledWith(tx)
		expect(pollMock).toHaveBeenCalledWith("abc123")
	})

	it.each([
		["txBadSeq", "sequence-consumed"],
		["txTooLate", "expired"],
		["txBadAuth", "bad-auth"],
		["txBadAuthExtra", "bad-auth"],
		["txInsufficientFee", "fee"],
		["txInsufficientBalance", "fee"],
		["txFailed", "unknown"],
	])("maps %s rejected on send to %s", async (code, reason) => {
		sendMock.mockResolvedValue(
			sent({ status: "ERROR", errorResult: transactionResult(code) }),
		)

		await expect(submitSigned(signedBy(signerOne))).resolves.toEqual({
			status: "failed",
			reason,
			hash: "abc123",
		})
		expect(pollMock).not.toHaveBeenCalled()
	})

	it("maps a transaction that failed after inclusion from its result", async () => {
		const tx = signedBy(signerOne)
		sendMock.mockResolvedValue(sent())
		pollMock.mockResolvedValue(
			polled(
				Api.GetTransactionStatus.FAILED,
				transactionResult("txBadSeq"),
				tx,
			),
		)

		await expect(submitSigned(tx)).resolves.toEqual({
			status: "failed",
			reason: "sequence-consumed",
			hash: "abc123",
		})
	})

	it("reports unknown when polling never finds the transaction", async () => {
		sendMock.mockResolvedValue(sent())
		pollMock.mockResolvedValue(notFound())

		await expect(submitSigned(signedBy(signerOne))).resolves.toEqual({
			status: "failed",
			reason: "unknown",
			hash: "abc123",
		})
	})

	it("reports unknown when the node rejects without a result", async () => {
		sendMock.mockResolvedValue(sent({ status: "ERROR" }))

		await expect(submitSigned(signedBy(signerOne))).resolves.toEqual({
			status: "failed",
			reason: "unknown",
			hash: "abc123",
		})
	})

	it("lets a transport error through", async () => {
		sendMock.mockRejectedValue(new TypeError("Failed to fetch"))

		await expect(submitSigned(signedBy(signerOne))).rejects.toThrow(
			"Failed to fetch",
		)
	})
})

describe("operator timeout", () => {
	beforeEach(() => fromMock.mockClear())

	it("reaches the contract client when a connect call asks for it", async () => {
		fromMock.mockResolvedValue({})

		await connectAsyncVault(
			contractId,
			{ publicKey: signerOne.publicKey(), signTransaction: vi.fn() },
			{ timeoutInSeconds: OPERATOR_TIMEOUT_SECONDS },
		)

		expect(fromMock.mock.calls[0]?.[0].timeoutInSeconds).toBe(604_800)
	})

	it("leaves the client default alone when no timeout is given", async () => {
		fromMock.mockResolvedValue({})

		await connectAsyncVault(contractId)

		expect(fromMock.mock.calls[0]?.[0].timeoutInSeconds).toBeUndefined()
	})
})

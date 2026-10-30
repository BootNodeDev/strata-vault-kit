import { Buffer } from "buffer"
import {
	Account,
	Address,
	BASE_FEE,
	hash,
	Keypair,
	nativeToScVal,
	Operation,
	SorobanDataBuilder,
	StrKey,
	TimeoutInfinite,
	type Transaction,
	TransactionBuilder,
	xdr,
} from "@stellar/stellar-sdk"
import {
	AssembledTransaction,
	Spec,
	type ClientOptions,
} from "@stellar/stellar-sdk/contract"
import { Api } from "@stellar/stellar-sdk/rpc"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Client as GeneratedClient } from "../vitest.clients"
import { connectAsyncVault } from "./contracts"
import { networkPassphrase } from "./env"
import {
	AUTHORIZATION_LEDGERS,
	authorizePending,
	decodePending,
	hasSigned,
	InvalidPendingTransaction,
	OPERATOR_TIMEOUT_SECONDS,
	prepareCoSigned,
	signatureWeight,
	submitSigned,
	transactionStatus,
} from "./multisig"

const { sendMock, pollMock, getMock, latestLedgerMock, simulateMock } =
	vi.hoisted(() => ({
		sendMock: vi.fn(),
		pollMock: vi.fn(),
		getMock: vi.fn(),
		latestLedgerMock: vi.fn(),
		simulateMock: vi.fn(),
	}))

vi.mock("./rpc", () => ({
	server: {
		sendTransaction: sendMock,
		pollTransaction: pollMock,
		getTransaction: getMock,
		getLatestLedger: latestLedgerMock,
		simulateTransaction: simulateMock,
	},
}))

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

describe("decodePending authority", () => {
	const encode = (tx: Transaction) => tx.toEnvelope().toXDR("base64")

	const authEntry = (credentials: xdr.SorobanCredentials) =>
		new xdr.SorobanAuthorizationEntry({
			credentials,
			rootInvocation: new xdr.SorobanAuthorizedInvocation({
				function:
					xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
						new xdr.InvokeContractArgs({
							contractAddress: new Address(contractId).toScAddress(),
							functionName: "set_nav",
							args: [],
						}),
					),
				subInvocations: [],
			}),
		})

	const withAuth = (entry: xdr.SorobanAuthorizationEntry) =>
		builder()
			.addOperation(
				Operation.invokeContractFunction({
					contract: contractId,
					function: "set_nav",
					args: [],
					auth: [entry],
				}),
			)
			.build()

	it("refuses an operation with a source other than the transaction's", () => {
		const tx = builder()
			.addOperation(
				Operation.invokeContractFunction({
					contract: contractId,
					function: "set_nav",
					args: [],
					source: outsider.publicKey(),
				}),
			)
			.build()

		expect(() => decodePending(encode(tx))).toThrow(InvalidPendingTransaction)
	})

	it("accepts an operation whose source is the transaction's", () => {
		const tx = builder()
			.addOperation(
				Operation.invokeContractFunction({
					contract: contractId,
					function: "set_nav",
					args: [],
					source: authority.publicKey(),
				}),
			)
			.build()

		expect(decodePending(encode(tx)).source).toBe(authority.publicKey())
	})

	it("refuses an auth entry with address credentials", () => {
		const entry = authEntry(
			xdr.SorobanCredentials.sorobanCredentialsAddress(
				new xdr.SorobanAddressCredentials({
					address: new Address(outsider.publicKey()).toScAddress(),
					nonce: xdr.Int64.fromString("1"),
					signatureExpirationLedger: 10,
					signature: xdr.ScVal.scvVoid(),
				}),
			),
		)

		expect(() => decodePending(encode(withAuth(entry)))).toThrow(
			InvalidPendingTransaction,
		)
	})

	it("accepts an auth entry with source account credentials", () => {
		const entry = authEntry(
			xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
		)

		expect(decodePending(encode(withAuth(entry))).fn).toBe("set_nav")
	})

	it("refuses a transaction that is not valid yet", () => {
		const minTime = Math.floor(Date.now() / 1000) + 3600
		const tx = builder({ minTime, maxTime }).addOperation(invokeOp()).build()

		expect(() => decodePending(encode(tx))).toThrow(InvalidPendingTransaction)
	})

	it("accepts a transaction whose minimum time has passed", () => {
		const tx = builder({ minTime: 1, maxTime }).addOperation(invokeOp()).build()

		expect(decodePending(encode(tx)).fn).toBe("set_nav")
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
			events: [],
		})
		expect(sendMock).toHaveBeenCalledWith(tx)
		expect(pollMock).toHaveBeenCalledWith("abc123")
	})

	it("carries the native return value of a successful transaction", async () => {
		const tx = signedBy(signerOne, signerTwo)
		sendMock.mockResolvedValue(sent())
		pollMock.mockResolvedValue({
			...polled(
				Api.GetTransactionStatus.SUCCESS,
				transactionResult("txSuccess"),
				tx,
			),
			returnValue: nativeToScVal(5n, { type: "u64" }),
		})

		await expect(submitSigned(tx)).resolves.toEqual({
			status: "success",
			hash: "abc123",
			result: 5n,
			events: [],
		})
	})

	it.each([
		["txBadSeq", "sequence-consumed"],
		["txTooLate", "expired"],
		["txBadAuth", "bad-auth"],
		["txBadAuthExtra", "bad-auth"],
		["txInsufficientFee", "fee-too-low"],
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

	it("fails without polling when the network asks to try again later", async () => {
		sendMock.mockResolvedValue(sent({ status: "TRY_AGAIN_LATER" }))

		await expect(submitSigned(signedBy(signerOne))).resolves.toEqual({
			status: "failed",
			reason: "not-accepted",
			hash: "abc123",
		})
		expect(pollMock).not.toHaveBeenCalled()
	})

	it("keeps polling a duplicate submission", async () => {
		const tx = signedBy(signerOne)
		sendMock.mockResolvedValue(sent({ status: "DUPLICATE" }))
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
			events: [],
		})
		expect(pollMock).toHaveBeenCalledWith("abc123")
	})

	it("lets a transport error through", async () => {
		sendMock.mockRejectedValue(new TypeError("Failed to fetch"))

		await expect(submitSigned(signedBy(signerOne))).rejects.toThrow(
			"Failed to fetch",
		)
	})
})

describe("transactionStatus", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each([
		[Api.GetTransactionStatus.SUCCESS, "success"],
		[Api.GetTransactionStatus.FAILED, "failed"],
		[Api.GetTransactionStatus.NOT_FOUND, "not-found"],
	] as const)("maps %s to %s", async (status, expected) => {
		getMock.mockResolvedValue({ ...notFound(), status })

		await expect(transactionStatus("abc123")).resolves.toBe(expected)
		expect(getMock).toHaveBeenCalledWith("abc123")
	})
})

const timeoutOf = (client: unknown): number | undefined => {
	if (!(client instanceof GeneratedClient))
		throw new Error("not the generated vault client")
	return client.options.timeoutInSeconds
}

describe("operator timeout", () => {
	it("reaches the contract client when a connect call asks for it", async () => {
		const client = await connectAsyncVault(
			contractId,
			{ publicKey: signerOne.publicKey(), signTransaction: vi.fn() },
			{ timeoutInSeconds: OPERATOR_TIMEOUT_SECONDS },
		)

		expect(timeoutOf(client)).toBe(604_800)
	})

	it("leaves the client default alone when no timeout is given", async () => {
		expect(timeoutOf(await connectAsyncVault(contractId))).toBeUndefined()
	})
})

const admin = Keypair.random()
const holder = Keypair.random().publicKey()

const transferArgs = (shares = 25n) => [
	new Address(holder).toScVal(),
	new Address(recipient).toScVal(),
	nativeToScVal(shares, { type: "i128" }),
	nativeToScVal("ORDER-1", { type: "string" }),
	new Address(authority.publicKey()).toScVal(),
]

const invocationArgs = (fn: string, args = transferArgs()) =>
	new xdr.InvokeContractArgs({
		contractAddress: new Address(contractId).toScAddress(),
		functionName: fn,
		args,
	})

const authorized = (
	args: xdr.InvokeContractArgs,
	subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
) =>
	new xdr.SorobanAuthorizedInvocation({
		function:
			xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
				args,
			),
		subInvocations,
	})

const addressEntry = (
	address: string,
	invocation = authorized(invocationArgs("legal_transfer")),
	signature = xdr.ScVal.scvVoid(),
	expiration = 0,
) =>
	new xdr.SorobanAuthorizationEntry({
		credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
			new xdr.SorobanAddressCredentials({
				address: new Address(address).toScAddress(),
				nonce: xdr.Int64.fromString("7"),
				signatureExpirationLedger: expiration,
				signature,
			}),
		),
		rootInvocation: invocation,
	})

const sourceEntry = () =>
	new xdr.SorobanAuthorizationEntry({
		credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
		rootInvocation: authorized(invocationArgs("legal_transfer")),
	})

const coSigned = (
	auth: xdr.SorobanAuthorizationEntry[],
	fn = "legal_transfer",
	args = transferArgs(),
) =>
	builder()
		.addOperation(
			Operation.invokeContractFunction({
				contract: contractId,
				function: fn,
				args,
				auth,
			}),
		)
		.build()
		.toEnvelope()
		.toXDR("base64")

const legalTransfer = () =>
	coSigned([sourceEntry(), addressEntry(admin.publicKey())])

describe("decodePending with a co-signer's authorization", () => {
	it("reads one unsigned address authorization on a legal transfer", () => {
		expect(decodePending(legalTransfer()).authorization).toEqual({
			address: admin.publicKey(),
			signed: false,
			expirationLedger: 0,
		})
	})

	it("reads a signed authorization and the ledger it expires after", () => {
		const signature = xdr.ScVal.scvVec([xdr.ScVal.scvMap([])])
		const encoded = coSigned([
			sourceEntry(),
			addressEntry(admin.publicKey(), undefined, signature, 900),
		])

		expect(decodePending(encoded).authorization).toEqual({
			address: admin.publicKey(),
			signed: true,
			expirationLedger: 900,
		})
	})

	it("has no authorization when every entry is the source account's", () => {
		expect(decodePending(coSigned([sourceEntry()])).authorization).toBeNull()
	})

	it("refuses two address authorizations", () => {
		const encoded = coSigned([
			addressEntry(admin.publicKey()),
			addressEntry(outsider.publicKey()),
		])

		expect(() => decodePending(encoded)).toThrow(InvalidPendingTransaction)
	})

	it("refuses an address authorization on any function but a legal transfer", () => {
		const args = [nativeToScVal(42n, { type: "i128" })]
		const encoded = coSigned(
			[
				addressEntry(
					admin.publicKey(),
					authorized(invocationArgs("forced_transfer", args)),
				),
			],
			"forced_transfer",
			args,
		)

		expect(() => decodePending(encoded)).toThrow(InvalidPendingTransaction)
	})

	it("refuses an authorization for an invocation the operation does not make", () => {
		const encoded = coSigned([
			addressEntry(
				admin.publicKey(),
				authorized(invocationArgs("legal_transfer", transferArgs(99n))),
			),
		])

		expect(() => decodePending(encoded)).toThrow(InvalidPendingTransaction)
	})

	it("refuses an authorization that also covers nested calls", () => {
		const nested = authorized(invocationArgs("legal_transfer"), [
			authorized(invocationArgs("transfer", [])),
		])
		const encoded = coSigned([addressEntry(admin.publicKey(), nested)])

		expect(() => decodePending(encoded)).toThrow(InvalidPendingTransaction)
	})

	it("refuses an authorization by a contract address", () => {
		const encoded = coSigned([addressEntry(contractId)])

		expect(() => decodePending(encoded)).toThrow(InvalidPendingTransaction)
	})
})

const legalTransferSpec = new Spec([
	xdr.ScSpecEntry.scSpecEntryFunctionV0(
		new xdr.ScSpecFunctionV0({
			doc: "",
			name: "legal_transfer",
			inputs: [],
			outputs: [],
		}),
	),
])

const assembled = (encoded: string, options: Partial<ClientOptions> = {}) =>
	AssembledTransaction.fromXDR(
		{
			contractId,
			networkPassphrase,
			rpcUrl: "http://localhost:8000/rpc",
			allowHttp: true,
			server: { simulateTransaction: simulateMock },
			...options,
		} as unknown as ClientOptions,
		encoded,
		legalTransferSpec,
	)

const simulated = (): Api.SimulateTransactionSuccessResponse => ({
	id: "1",
	latestLedger: 1_000,
	events: [],
	_parsed: true,
	transactionData: new SorobanDataBuilder().setResourceFee(5_000),
	minResourceFee: "5000",
	result: { auth: [], retval: xdr.ScVal.scvVoid() },
})

const refused = (code: number): Api.SimulateTransactionErrorResponse => ({
	id: "1",
	latestLedger: 1_000,
	events: [],
	_parsed: true,
	error: `HostError: Error(Contract, #${code})`,
})

const adminWallet = vi.fn(async (preimage: string) => ({
	signedAuthEntry: admin
		.sign(hash(Buffer.from(preimage, "base64")))
		.toString("base64"),
	signerAddress: admin.publicKey(),
}))

describe("authorizePending", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		latestLedgerMock.mockResolvedValue({ sequence: 1_000 })
		simulateMock.mockResolvedValue(simulated())
	})

	it("signs the admin's entry for the operator timeout and re-simulates", async () => {
		const encoded = legalTransfer()
		const pending = decodePending(encoded)

		const step = await authorizePending(
			assembled(encoded),
			pending,
			adminWallet,
		)

		if (step.kind !== "ready") throw new Error(`unexpected ${step.kind}`)
		expect(decodePending(step.xdr)).toEqual(step.pending)
		expect(step.pending.authorization).toEqual({
			address: admin.publicKey(),
			signed: true,
			expirationLedger: 1_000 + AUTHORIZATION_LEDGERS,
		})
		expect(AUTHORIZATION_LEDGERS).toBe(OPERATOR_TIMEOUT_SECONDS / 5)
		expect(adminWallet).toHaveBeenCalledWith(expect.any(String), {
			address: admin.publicKey(),
		})
		expect(simulateMock).toHaveBeenCalledTimes(1)
		expect(step.pending.args).toEqual(pending.args)
		expect(step.pending.expiresAt).toEqual(pending.expiresAt)
	})

	it("reports the contract's refusal from the re-simulation", async () => {
		simulateMock.mockResolvedValue(refused(300))
		const encoded = legalTransfer()

		await expect(
			authorizePending(assembled(encoded), decodePending(encoded), adminWallet),
		).resolves.toEqual({ kind: "refused", code: 300 })
	})

	it("refuses a transaction whose authorization is already signed", async () => {
		const signature = xdr.ScVal.scvVec([xdr.ScVal.scvMap([])])
		const encoded = coSigned([
			sourceEntry(),
			addressEntry(admin.publicKey(), undefined, signature, 900),
		])

		await expect(
			authorizePending(assembled(encoded), decodePending(encoded), adminWallet),
		).rejects.toThrow(InvalidPendingTransaction)
		expect(adminWallet).not.toHaveBeenCalled()
	})
})

describe("prepareCoSigned", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		latestLedgerMock.mockResolvedValue({ sequence: 1_000 })
		simulateMock.mockResolvedValue(simulated())
	})

	const authorizedTransfer = async () => {
		const encoded = legalTransfer()
		const step = await authorizePending(
			assembled(encoded),
			decodePending(encoded),
			adminWallet,
		)
		if (step.kind !== "ready") throw new Error(`unexpected ${step.kind}`)
		return step.pending
	}

	it("re-simulates and starts the operator timeout now, keeping the authorization", async () => {
		const pending = await authorizedTransfer()
		const encoded = pending.transaction.toEnvelope().toXDR("base64")
		const before = Date.now()

		const step = await prepareCoSigned(assembled(encoded), pending)

		if (step.kind !== "ready") throw new Error(`unexpected ${step.kind}`)
		const expiresAt = step.pending.expiresAt?.getTime() ?? 0
		expect(expiresAt).toBeGreaterThanOrEqual(
			Math.floor(before / 1000) * 1000 + OPERATOR_TIMEOUT_SECONDS * 1000,
		)
		expect(step.pending.authorization).toEqual(pending.authorization)
		expect(step.pending.transaction.fee).toBe(pending.transaction.fee)
		expect(step.pending.sequence).toBe(pending.sequence)
		expect(step.pending.transaction.signatures).toEqual([])
	})

	it("reports the contract's refusal from the simulation", async () => {
		const pending = await authorizedTransfer()
		simulateMock.mockResolvedValue(refused(304))

		await expect(
			prepareCoSigned(
				assembled(pending.transaction.toEnvelope().toXDR("base64")),
				pending,
			),
		).resolves.toEqual({ kind: "refused", code: 304 })
	})

	it("refuses a transaction the admin has not authorized", async () => {
		const encoded = legalTransfer()

		await expect(
			prepareCoSigned(assembled(encoded), decodePending(encoded)),
		).rejects.toThrow(InvalidPendingTransaction)
	})
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock("@stellar/stellar-sdk/contract", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@stellar/stellar-sdk/contract")>()
	return { ...actual, Client: { from: fromMock } }
})

import {
	connectAsyncVault,
	connectIdentityVerifier,
	connectNavOracle,
	connectShareToken,
	type Signer,
} from "./contracts"

describe.each([
	{ name: "connectAsyncVault", connect: connectAsyncVault },
	{ name: "connectNavOracle", connect: connectNavOracle },
	{ name: "connectShareToken", connect: connectShareToken },
	{ name: "connectIdentityVerifier", connect: connectIdentityVerifier },
] satisfies {
	name: string
	connect: (contractId: string, signer?: Signer) => Promise<unknown>
}[])("$name", ({ connect }) => {
	beforeEach(() => fromMock.mockClear())

	it("builds a read client with no publicKey or signTransaction when no signer is given", async () => {
		fromMock.mockResolvedValue({})

		await connect("CCONTRACT")

		const options = fromMock.mock.calls[0]?.[0]
		expect(options.contractId).toBe("CCONTRACT")
		expect(options.publicKey).toBeUndefined()
		expect(options.signTransaction).toBeUndefined()
	})

	it("carries the connected address and signer when one is given", async () => {
		fromMock.mockResolvedValue({})
		const signTransaction = vi.fn()

		await connect("CCONTRACT", { publicKey: "GSIGNER", signTransaction })

		const options = fromMock.mock.calls[0]?.[0]
		expect(options.publicKey).toBe("GSIGNER")
		expect(options.signTransaction).toBe(signTransaction)
	})
})

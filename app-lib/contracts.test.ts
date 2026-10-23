import type { ClientOptions } from "@stellar/stellar-sdk/contract"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Client as GeneratedClient } from "../vitest.clients"
import {
	connectAsset,
	connectAsyncVault,
	connectIdentityVerifier,
	connectNavOracle,
	connectShareToken,
	type Signer,
} from "./contracts"
import { server } from "./rpc"

const optionsOf = (client: unknown): ClientOptions => {
	if (!(client instanceof GeneratedClient))
		throw new Error("not built from the generated bindings")
	return client.options
}

describe.each([
	{ name: "connectAsyncVault", connect: connectAsyncVault },
	{ name: "connectNavOracle", connect: connectNavOracle },
	{ name: "connectShareToken", connect: connectShareToken },
	{ name: "connectIdentityVerifier", connect: connectIdentityVerifier },
	{ name: "connectAsset", connect: connectAsset },
] satisfies {
	name: string
	connect: (contractId: string, signer?: Signer) => Promise<unknown>
}[])("$name", ({ connect }) => {
	const fetchMock = vi.fn()

	beforeEach(() => {
		fetchMock.mockReset()
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => vi.unstubAllGlobals())

	it("builds the client from the generated bindings without asking the RPC for the contract", async () => {
		const options = optionsOf(await connect("CCONTRACT"))

		expect(options.contractId).toBe("CCONTRACT")
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("sends the client's calls through the shared RPC server", async () => {
		const options = optionsOf(await connect("CCONTRACT"))

		expect(options.server).toBe(server)
	})

	it("builds a read client with no publicKey or signTransaction when no signer is given", async () => {
		const options = optionsOf(await connect("CCONTRACT"))

		expect(options.publicKey).toBeUndefined()
		expect(options.signTransaction).toBeUndefined()
	})
})

describe.each([
	{ name: "connectAsyncVault", connect: connectAsyncVault },
	{ name: "connectNavOracle", connect: connectNavOracle },
	{ name: "connectShareToken", connect: connectShareToken },
	{ name: "connectIdentityVerifier", connect: connectIdentityVerifier },
] satisfies {
	name: string
	connect: (contractId: string, signer?: Signer) => Promise<unknown>
}[])("$name", ({ connect }) => {
	it("carries the connected address and signer when one is given", async () => {
		const signTransaction = vi.fn()

		const options = optionsOf(
			await connect("CCONTRACT", { publicKey: "GSIGNER", signTransaction }),
		)

		expect(options.publicKey).toBe("GSIGNER")
		expect(options.signTransaction).toBe(signTransaction)
	})
})

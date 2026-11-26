import { xdr } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"

import { identityWasmKey, identityWasmOf } from "./registry-keys.js"

const HASH = Buffer.alloc(32, 0x22)

function instance(storage: xdr.ScMapEntry[] | null): xdr.ScContractInstance {
	return new xdr.ScContractInstance({
		executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
		storage,
	})
}

const stored = (val: xdr.ScVal): xdr.ScMapEntry =>
	new xdr.ScMapEntry({ key: identityWasmKey(), val })

describe("identityWasmKey", () => {
	it("is the unit variant's vec with its name", () => {
		expect(identityWasmKey().toXDR("hex")).toBe(
			xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("IdentityWasm")]).toXDR("hex"),
		)
	})
})

describe("identityWasmOf", () => {
	it("reads the hash a registry deploys identities from", () => {
		expect(identityWasmOf(instance([stored(xdr.ScVal.scvBytes(HASH))]))).toBe(
			HASH.toString("hex"),
		)
	})

	it.each([
		["no storage", null],
		["no identity code", []],
	])("answers nothing for an instance with %s", (_, storage) => {
		expect(identityWasmOf(instance(storage))).toBeUndefined()
	})

	it("stops on a value that is not a 32-byte hash", () => {
		expect(() =>
			identityWasmOf(instance([stored(xdr.ScVal.scvBytes(Buffer.alloc(31)))])),
		).toThrow(/not a 32-byte hash/)
		expect(() =>
			identityWasmOf(instance([stored(xdr.ScVal.scvU32(1))])),
		).toThrow(/scvU32/)
	})
})

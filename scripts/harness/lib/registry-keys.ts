import { xdr } from "@stellar/stellar-sdk"

/** `DataKey::IdentityWasm` (`contracts/identity-registry/src/governance.rs`). */
export function identityWasmKey(): xdr.ScVal {
	return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("IdentityWasm")])
}

/**
 * The hex hash of the code a registry deploys investor identities from, or
 * `undefined` for an instance that stores none.
 */
export function identityWasmOf(
	instance: xdr.ScContractInstance,
): string | undefined {
	const target = identityWasmKey().toXDR("base64")
	const entry = instance
		.storage()
		?.find((candidate) => candidate.key().toXDR("base64") === target)
	if (entry === undefined) return undefined

	const val = entry.val()
	const bytes = val.switch().name === "scvBytes" ? val.bytes() : null
	if (bytes === null || bytes.length !== 32) {
		throw new Error(
			`instance storage holds IdentityWasm as ${val.switch().name}, not a 32-byte hash`,
		)
	}
	return bytes.toString("hex")
}

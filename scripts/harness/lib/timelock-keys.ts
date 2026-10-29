import { xdr } from "@stellar/stellar-sdk"

/** `Key::TimelockPending(id)` (`crates/strata-timelock/src/keys.rs`). */
export function pendingChangeKey(id: number): xdr.ScVal {
	return xdr.ScVal.scvVec([
		xdr.ScVal.scvSymbol("TimelockPending"),
		xdr.ScVal.scvU32(id),
	])
}

/** `Key::TimelockOpen` (`crates/strata-timelock/src/keys.rs`). */
export function openChangesKey(): xdr.ScVal {
	return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("TimelockOpen")])
}

/** The ids waiting in `instance`'s queue, in stored order, or `[]` with no queue. */
export function openChangeIds(instance: xdr.ScContractInstance): number[] {
	const target = openChangesKey().toXDR("base64")
	const entry = instance
		.storage()
		?.find((candidate) => candidate.key().toXDR("base64") === target)
	if (entry === undefined) return []

	const val = entry.val()
	const vec = val.switch().name === "scvVec" ? val.vec() : null
	if (vec === null || vec.some((item) => item.switch().name !== "scvU32")) {
		throw new Error(
			`instance storage holds TimelockOpen as ${val.switch().name}, not a vec of u32`,
		)
	}
	return vec.map((item) => item.u32())
}

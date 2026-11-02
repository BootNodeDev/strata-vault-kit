import { afterEach, describe, expect, it, vi } from "vitest"

import { network } from "./network.js"

afterEach(() => {
	vi.unstubAllEnvs()
})

describe("network", () => {
	it.each(["local", "testnet"] as const)(
		"%s sets the vault notice to twice the oracle cooldown",
		(name) => {
			vi.stubEnv("HARNESS_NETWORK", name)
			const net = network()
			expect(net.vault.notice_secs).toBe(2 * net.oracle.cooldown_secs)
			expect(net.vault.notice_secs).toBeGreaterThan(0)
		},
	)

	it.each(["local", "testnet"] as const)(
		"%s sets the vault's minimum epoch duration to one day",
		(name) => {
			vi.stubEnv("HARNESS_NETWORK", name)
			const net = network()
			// MIN_EPOCH_DURATION_FLOOR in contracts/async-vault/src/lib.rs: the
			// contract refuses anything shorter.
			expect(net.vault.min_epoch_duration_secs).toBe(24 * 60 * 60)
		},
	)
})

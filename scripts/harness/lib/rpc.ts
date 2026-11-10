import { setTimeout as sleep } from "node:timers/promises"

import { type rpc } from "@stellar/stellar-sdk"

const ATTEMPTS = 10
const INTERVAL_MS = 1_000

function isAccountNotFound(error: unknown): error is Error {
	return error instanceof Error && error.message.startsWith("Account not found")
}

// Never wrap code that expects "not found" to mean the account is new.
export function withAccountRetry<S extends Pick<rpc.Server, "getAccount">>(
	server: S,
	wait: (ms: number) => Promise<void> = sleep,
): S {
	const getAccount = server.getAccount.bind(server)
	server.getAccount = async (address: string) => {
		for (let attempt = 1; ; attempt += 1) {
			try {
				return await getAccount(address)
			} catch (error) {
				if (!isAccountNotFound(error)) throw error
				if (attempt >= ATTEMPTS) {
					throw new Error(
						`${error.message} (after ${ATTEMPTS} tries; the SDK reports an unreachable RPC the same way)`,
						{ cause: error },
					)
				}
				await wait(INTERVAL_MS)
			}
		}
	}
	return server
}

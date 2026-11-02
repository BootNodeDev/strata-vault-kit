// Types for clients.mjs, which the harness imports from TypeScript.
import type { BindingGenerator } from "@stellar/stellar-sdk"

export function missingClients(root: string): string[]

export function writeClient(
	dir: string,
	files: ReturnType<BindingGenerator["generate"]>,
): void

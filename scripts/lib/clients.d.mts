import type { BindingGenerator } from "@stellar/stellar-sdk"

export function missingClients(root: string): string[]

export function writeClient(
	root: string,
	name: string,
	files: ReturnType<BindingGenerator["generate"]>,
): void

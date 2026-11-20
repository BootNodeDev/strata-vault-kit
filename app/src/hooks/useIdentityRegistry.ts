import { readContract } from "@stellar-scaffold/app-lib"
import { queryOptions, skipToken } from "@tanstack/react-query"
import { identityVerifierAt } from "../config/clients"

export const identityRegistryKey = ["identity", "registry"] as const

export async function identityRegistryOf(verifier: string): Promise<string> {
	const read = await readContract(async () =>
		(await identityVerifierAt(verifier)).identity_registry(),
	)
	if (read.kind !== "value") {
		throw new Error(
			`identity verifier identity_registry read failed: ${read.kind}`,
		)
	}
	return read.value
}

export const identityRegistryQuery = (verifier: string | undefined) =>
	queryOptions({
		queryKey: [...identityRegistryKey, verifier] as const,
		queryFn:
			verifier === undefined ? skipToken : () => identityRegistryOf(verifier),
		staleTime: 30_000,
	})

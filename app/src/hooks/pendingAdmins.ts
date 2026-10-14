import { readPendingAdmins } from "@stellar-scaffold/app-lib"
import { queryOptions, skipToken } from "@tanstack/react-query"

export const governanceReadsKey = ["governance", "reads"] as const

export type GovernedContract = "vault" | "oracle" | "token"

export const GOVERNED_CONTRACTS: GovernedContract[] = [
	"vault",
	"oracle",
	"token",
]

export const pendingAdminsQuery = (
	contracts: Record<GovernedContract, string> | undefined,
) =>
	queryOptions({
		queryKey: [...governanceReadsKey, "pendingAdmins", contracts] as const,
		queryFn:
			contracts === undefined
				? skipToken
				: async () => {
						const read = await readPendingAdmins(
							GOVERNED_CONTRACTS.map((contract) => contracts[contract]),
						)
						if (read.kind !== "value") {
							throw new Error("The pending admins could not be read.")
						}
						return read.value
					},
		staleTime: 30_000,
	})

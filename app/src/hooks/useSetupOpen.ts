import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault, navOracle, shareToken } from "../config/clients"

export type SetupState = "checking" | "open" | "closed" | "unreadable"

export type TimelockedContract = "vault" | "token" | "oracle"

export const setupOpenKey = (contract: TimelockedContract) =>
	[contract, "setupOpen"] as const

export const classifySetup = (read: ContractRead<boolean>): SetupState => {
	if (read.kind !== "value") return "unreadable"
	return read.value ? "open" : "closed"
}

const READERS = {
	vault: async () => (await asyncVault()).setup_open(),
	token: async () => (await shareToken()).setup_open(),
	oracle: async () => (await navOracle()).setup_open(),
} satisfies Record<TimelockedContract, unknown>

async function fetchSetupOpen(
	contract: TimelockedContract,
): Promise<SetupState> {
	const read = await readContract(READERS[contract])
	return classifySetup(read)
}

export function useSetupOpen(contract: TimelockedContract): {
	setup: SetupState
} {
	const { data } = useQuery({
		queryKey: setupOpenKey(contract),
		queryFn: () => fetchSetupOpen(contract),
		staleTime: 30_000,
		refetchInterval: 15_000,
	})
	return { setup: data ?? "checking" }
}

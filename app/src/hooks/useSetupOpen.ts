import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"

export type SetupState = "checking" | "open" | "closed" | "unreadable"

export const setupOpenKey = ["vault", "setupOpen"] as const

export const classifySetup = (read: ContractRead<boolean>): SetupState => {
	if (read.kind !== "value") return "unreadable"
	return read.value ? "open" : "closed"
}

async function fetchSetupOpen(): Promise<SetupState> {
	const read = await readContract(async () => (await asyncVault()).setup_open())
	return classifySetup(read)
}

export function useSetupOpen(): { setup: SetupState } {
	const { data } = useQuery({
		queryKey: setupOpenKey,
		queryFn: fetchSetupOpen,
		staleTime: 30_000,
		refetchInterval: 15_000,
	})
	return { setup: data ?? "checking" }
}

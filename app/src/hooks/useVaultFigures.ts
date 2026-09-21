import { type Amount } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"
import { type ContractRead, readContract } from "../lib/readContract"

export type FigureKey =
	"liquidReserve" | "committed" | "uncovered" | "economicSupply" | "netDeployed"

export type VaultFigures = Record<FigureKey, Amount | null>

const toAmount = (read: ContractRead<bigint>): Amount | null =>
	read.kind === "value" ? (read.value as Amount) : null

async function fetchVaultFigures(): Promise<VaultFigures> {
	const [liquidReserve, committed, uncovered, economicSupply, netDeployed] =
		await Promise.all([
			readContract(() => asyncVault.liquid_reserve()),
			readContract(() => asyncVault.committed()),
			readContract(() => asyncVault.uncovered()),
			readContract(() => asyncVault.total_economic_supply()),
			readContract(() => asyncVault.net_deployed()),
		])

	return {
		liquidReserve: toAmount(liquidReserve),
		committed: toAmount(committed),
		uncovered: toAmount(uncovered),
		economicSupply: toAmount(economicSupply),
		netDeployed: toAmount(netDeployed),
	}
}

export function useVaultFigures(): {
	figures: VaultFigures | undefined
	isPending: boolean
} {
	const { data, isPending } = useQuery({
		queryKey: ["vault", "figures"],
		queryFn: fetchVaultFigures,
		staleTime: 30_000,
	})

	return { figures: data, isPending }
}

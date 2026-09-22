import {
	type Amount,
	type ContractRead,
	readContract,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"

export type FigureKey =
	"liquidReserve" | "committed" | "uncovered" | "economicSupply" | "netDeployed"

export type VaultFigures = Record<FigureKey, Amount | null>

const toAmount = (read: ContractRead<bigint>): Amount | null =>
	read.kind === "value" ? (read.value as Amount) : null

async function fetchVaultFigures(): Promise<VaultFigures> {
	const [liquidReserve, committed, uncovered, economicSupply, netDeployed] =
		await Promise.all([
			readContract(async () => (await asyncVault()).liquid_reserve()),
			readContract(async () => (await asyncVault()).committed()),
			readContract(async () => (await asyncVault()).uncovered()),
			readContract(async () => (await asyncVault()).total_economic_supply()),
			readContract(async () => (await asyncVault()).net_deployed()),
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

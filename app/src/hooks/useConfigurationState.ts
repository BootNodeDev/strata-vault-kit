import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault, shareToken } from "../config/clients"
import {
	type DepositCap,
	type OracleLimits,
	useCycleReads,
} from "./useCycleState"
import { type Custodian, useVaultAuthorities } from "./useVaultAuthorities"

const STALE_MS = 30_000
const REFRESH_MS = 15_000

export const configurationReadsKey = ["configuration", "reads"] as const

export type ConfigurationValues = {
	depositCap: DepositCap | null
	custodian: Custodian
	notice: bigint | null
	windDownDelay: bigint | null
	upgradeDelay: bigint | null
	oracle: OracleLimits | null
	compliance: string | null
	identityVerifier: string | null
}

export type ConfigurationState =
	{ status: "checking" } | ({ status: "ready" } & ConfigurationValues)

const valueOf = <T>(read: ContractRead<T>): T | null =>
	read.kind === "value" ? read.value : null

async function fetchConfigurationReads() {
	const [upgradeDelay, compliance, identityVerifier] = await Promise.all([
		readContract(async () => (await asyncVault()).upgrade_delay()),
		readContract(async () => (await shareToken()).compliance()),
		readContract(async () => (await shareToken()).identity_verifier()),
	])
	return {
		upgradeDelay: valueOf(upgradeDelay),
		compliance: valueOf(compliance),
		identityVerifier: valueOf(identityVerifier),
	}
}

export function useConfigurationState({
	active = true,
}: { active?: boolean } = {}): { configuration: ConfigurationState } {
	const cycle = useCycleReads(active)
	const { authorities, isPending } = useVaultAuthorities()
	const { data: reads } = useQuery({
		queryKey: configurationReadsKey,
		queryFn: fetchConfigurationReads,
		staleTime: STALE_MS,
		refetchInterval: active ? REFRESH_MS : false,
	})

	if (cycle === undefined || reads === undefined || isPending)
		return { configuration: { status: "checking" } }

	return {
		configuration: {
			status: "ready",
			depositCap: cycle.depositCap,
			custodian: authorities?.custodian ?? { kind: "unreadable" },
			notice: valueOf(cycle.notice),
			windDownDelay: cycle.windDown.delay,
			oracle: cycle.oracle.limits,
			...reads,
		},
	}
}

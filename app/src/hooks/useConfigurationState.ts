import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault, shareToken } from "../config/clients"
import {
	type DepositCap,
	type OracleLimits,
	useCycleReads,
} from "./useCycleState"
import { type SetupState, useSetupOpen } from "./useSetupOpen"
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
	setupOpen: boolean | null
	tokenSetupOpen: boolean | null
	oracle: OracleLimits | null
	compliance: string | null
	identityVerifier: string | null
}

export type ConfigurationState =
	{ status: "checking" } | ({ status: "ready" } & ConfigurationValues)

const openOf = (setup: SetupState): boolean | null =>
	setup === "unreadable" ? null : setup === "open"

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

export function useConfigurationState(): {
	configuration: ConfigurationState
} {
	const cycle = useCycleReads()
	const { authorities, isPending } = useVaultAuthorities()
	const { setup } = useSetupOpen("vault")
	const { setup: tokenSetup } = useSetupOpen("token")
	const { data: reads } = useQuery({
		queryKey: configurationReadsKey,
		queryFn: fetchConfigurationReads,
		staleTime: STALE_MS,
		refetchInterval: REFRESH_MS,
	})

	if (
		cycle === undefined ||
		reads === undefined ||
		isPending ||
		setup === "checking" ||
		tokenSetup === "checking"
	)
		return { configuration: { status: "checking" } }

	return {
		configuration: {
			status: "ready",
			depositCap: cycle.depositCap,
			custodian: authorities?.custodian ?? { kind: "unreadable" },
			notice: valueOf(cycle.notice),
			windDownDelay: cycle.windDown.delay,
			setupOpen: openOf(setup),
			tokenSetupOpen: openOf(tokenSetup),
			oracle: cycle.oracle.limits,
			...reads,
		},
	}
}

import {
	type Amount,
	type ChainEvent,
	type ContractRead,
	type NavReport,
	type OracleState,
	type Price,
	readContract,
	readEvents,
	readLedgerTime,
} from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { addresses } from "../config/addresses"
import { asset, asyncVault, navOracle } from "../config/clients"
import {
	type EpochHistoryRead,
	type EpochRecord,
	epochHistoryKey,
	useEpochHistory,
} from "./useEpochHistory"
import { classifyNav, type NavClassification } from "./useNavPrice"
import { useVaultAuthorities } from "./useVaultAuthorities"
import { useVaultFigures } from "./useVaultFigures"
import { type PauseState, useVaultPaused } from "./useVaultPaused"

const STALE_MS = 30_000
const REFRESH_MS = 15_000
const LEDGERS_IN_SEVEN_DAYS = (7 * 24 * 60 * 60) / 5
const VAULT_EVENTS = [
	"epoch_closed",
	"epoch_fulfilled",
	"deposit_requested",
	"deposit_claimed",
]
const ORACLE_EVENTS = ["nav_attested"]

export const cycleReadsKey = ["cycle", "reads"] as const
export const cycleEventsKey = ["cycle", "events"] as const
export const cycleWriteKeys = [
	epochHistoryKey,
	cycleReadsKey,
	cycleEventsKey,
	["vault", "figures"],
] as const

export type OracleLimits = {
	freshness: bigint
	cooldown: bigint
	maxUpBps: number
	maxDownBps: number | null
	min: bigint
	max: bigint
}

export type CycleOracle = {
	state: NavClassification["status"]
	price: Price | null
	attestedAt: bigint | null
	expiresAt: bigint | null
	ripcord: boolean | null
	limits: OracleLimits | null
}

export type DepositCap =
	{ kind: "uncapped" } | { kind: "capped"; amount: Amount }

export type WindDownPhase = "none" | "proposed" | "active"

export type CycleWindDown = {
	phase: WindDownPhase | null
	activeAt: bigint | null
	round: number | null
	delay: bigint | null
	owed: Amount | null
	supply: Amount | null
}

export type CycleReserve = {
	free: Amount | null
	committed: Amount | null
	uncovered: Amount | null
	liquid: Amount | null
	netDeployed: Amount | null
	depositCap: DepositCap | null
	custodian: string | null
	custodianBalance: Amount | null
}

export type CycleEpoch = {
	id: bigint
	open: EpochRecord | null
	awaiting: EpochRecord | null
	awaitingKnown: boolean
	noticeSeconds: bigint | null
}

export type CycleState =
	| { status: "checking" }
	| { status: "unreadable" }
	| {
			status: "ready"
			ledgerTime: bigint | null
			epoch: CycleEpoch
			oracle: CycleOracle
			reserve: CycleReserve
			windDown: CycleWindDown
			paused: PauseState
	  }

const toAmount = (read: ContractRead<bigint>): Amount | null =>
	read.kind === "value" ? (read.value as Amount) : null

export function toOracle(
	state: ContractRead<OracleState>,
	latest: ContractRead<NavReport>,
	config: ContractRead<{
		freshness_duration: bigint
		cooldown_secs: bigint
		max_up_bps: number
		max_down_bps: number | null
		min_answer: bigint
		max_answer: bigint
	}>,
): CycleOracle {
	const nav = classifyNav(state, latest)
	const report = latest.kind === "value" ? latest.value : null

	return {
		state: nav.status,
		price: report === null ? null : (report.nav_per_share as Price),
		attestedAt: report?.timestamp ?? null,
		expiresAt: report?.expires_at ?? null,
		ripcord: nav.status === "unreadable" ? null : nav.status === "paused",
		limits:
			config.kind === "value"
				? {
						freshness: config.value.freshness_duration,
						cooldown: config.value.cooldown_secs,
						maxUpBps: config.value.max_up_bps,
						maxDownBps: config.value.max_down_bps,
						min: config.value.min_answer,
						max: config.value.max_answer,
					}
				: null,
	}
}

export function toWindDown(
	proposal: ContractRead<{
		active_at: bigint
		round: number
		status: { tag: "Proposed" | "Active" }
	} | null>,
	delay: ContractRead<bigint>,
	owed: ContractRead<bigint>,
	supply: ContractRead<bigint>,
): CycleWindDown {
	const proposed = proposal.kind === "value" ? proposal.value : undefined
	return {
		phase:
			proposed === undefined
				? null
				: proposed === null
					? "none"
					: proposed.status.tag === "Active"
						? "active"
						: "proposed",
		activeAt: proposed?.active_at ?? null,
		round: proposed?.round ?? null,
		delay: delay.kind === "value" ? delay.value : null,
		owed: toAmount(owed),
		supply: toAmount(supply),
	}
}

const toDepositCap = (read: ContractRead<bigint | null>): DepositCap | null => {
	if (read.kind !== "value") return null
	return read.value === null
		? { kind: "uncapped" }
		: { kind: "capped", amount: read.value as Amount }
}

export function toEpoch(
	history: Extract<EpochHistoryRead, { status: "loaded" }>,
	notice: ContractRead<bigint>,
): CycleEpoch {
	const sealed = history.epochs.filter((epoch) => epoch.status === "Pending")
	return {
		id: history.currentEpoch,
		open:
			history.epochs.find((epoch) => epoch.id === history.currentEpoch) ?? null,
		awaiting: sealed.at(-1) ?? null,
		awaitingKnown: history.unreadable.length === 0,
		noticeSeconds: notice.kind === "value" ? notice.value : null,
	}
}

type CycleReads = {
	ledgerTime: bigint | null
	notice: ContractRead<bigint>
	freeReserve: Amount | null
	depositCap: DepositCap | null
	windDown: CycleWindDown
	oracle: CycleOracle
}

async function fetchCycleReads(): Promise<CycleReads> {
	const [
		ledgerTime,
		notice,
		freeReserve,
		depositCap,
		proposal,
		delay,
		owed,
		supply,
		oracleState,
		latest,
		config,
	] = await Promise.all([
		readLedgerTime(),
		readContract(async () => (await asyncVault()).notice()),
		readContract(async () => (await asyncVault()).free_reserve()),
		readContract(async () => (await asyncVault()).deposit_cap()),
		readContract(async () => (await asyncVault()).wind_down()),
		readContract(async () => (await asyncVault()).wind_down_delay()),
		readContract(async () => (await asyncVault()).wind_down_owed()),
		readContract(async () => (await asyncVault()).wind_down_supply()),
		readContract(async () => (await navOracle()).state()),
		readContract(async () => (await navOracle()).latest()),
		readContract(async () => (await navOracle()).config()),
	])

	return {
		ledgerTime,
		notice,
		freeReserve: toAmount(freeReserve),
		depositCap: toDepositCap(depositCap),
		windDown: toWindDown(proposal, delay, owed, supply),
		oracle: toOracle(oracleState, latest, config),
	}
}

async function fetchCustodianBalance(
	custodian: string,
): Promise<Amount | null> {
	const balance = await readContract(async () =>
		(await asset()).balance({ id: custodian }),
	)
	return toAmount(balance)
}

export function useCycleState(): { cycle: CycleState } {
	const { history } = useEpochHistory()
	const { figures, isPending: figuresPending } = useVaultFigures()
	const { pause } = useVaultPaused()
	const { authorities, isPending: authoritiesPending } = useVaultAuthorities()
	const { data: reads } = useQuery({
		queryKey: cycleReadsKey,
		queryFn: fetchCycleReads,
		staleTime: STALE_MS,
		refetchInterval: REFRESH_MS,
	})
	const custodian = authorities?.custodian ?? null
	const { data: custodianBalance, isPending: balancePending } = useQuery({
		queryKey: ["cycle", "custodianBalance", custodian],
		queryFn:
			custodian === null ? skipToken : () => fetchCustodianBalance(custodian),
		staleTime: STALE_MS,
	})

	if (history.status === "unreadable")
		return { cycle: { status: "unreadable" } }
	const checking =
		history.status === "checking" ||
		reads === undefined ||
		figuresPending ||
		authoritiesPending ||
		pause === "checking" ||
		(custodian !== null && balancePending)
	if (checking) return { cycle: { status: "checking" } }

	return {
		cycle: {
			status: "ready",
			ledgerTime: reads.ledgerTime,
			epoch: toEpoch(history, reads.notice),
			oracle: reads.oracle,
			reserve: {
				free: reads.freeReserve,
				committed: figures?.committed ?? null,
				uncovered: figures?.uncovered ?? null,
				liquid: figures?.liquidReserve ?? null,
				netDeployed: figures?.netDeployed ?? null,
				depositCap: reads.depositCap,
				custodian,
				custodianBalance: custodianBalance ?? null,
			},
			windDown: reads.windDown,
			paused: pause,
		},
	}
}

export type CycleEventsRead =
	| { status: "checking" }
	| { status: "unreadable" }
	| { status: "loaded"; events: ChainEvent[]; partial: boolean }

async function fetchCycleEvents(): Promise<CycleEventsRead> {
	const read = await readEvents(
		[
			{ contractId: addresses.async_vault, names: VAULT_EVENTS },
			{ contractId: addresses.nav_oracle, names: ORACLE_EVENTS },
		],
		LEDGERS_IN_SEVEN_DAYS,
	)
	return read.kind === "value"
		? { status: "loaded", events: read.value, partial: read.partial }
		: { status: "unreadable" }
}

export function useCycleEvents(): { cycleEvents: CycleEventsRead } {
	const { data } = useQuery({
		queryKey: cycleEventsKey,
		queryFn: fetchCycleEvents,
		staleTime: STALE_MS,
	})

	return { cycleEvents: data ?? { status: "checking" } }
}

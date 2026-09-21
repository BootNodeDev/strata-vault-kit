import {
	type ContractRead,
	type NavReport,
	type OracleState,
	type Price,
	readContract,
} from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { navOracle } from "../config/clients"

export type NavClassification =
	| { status: "valid"; price: Price; attestedAt: bigint }
	| { status: "stale"; expiresAt: bigint }
	| { status: "paused" }
	| { status: "never" }
	| { status: "unreadable" }

export function classifyNav(
	state: ContractRead<OracleState>,
	latest: ContractRead<NavReport>,
): NavClassification {
	if (state.kind !== "value") return { status: "unreadable" }
	if (state.value.tag === "Paused") return { status: "paused" }

	if (state.value.tag === "Stale") {
		if (latest.kind === "contract-error" && latest.code === 3006)
			return { status: "never" }
		return latest.kind === "value"
			? { status: "stale", expiresAt: latest.value.expires_at }
			: { status: "unreadable" }
	}

	return latest.kind === "value"
		? {
				status: "valid",
				price: latest.value.nav_per_share as Price,
				attestedAt: latest.value.timestamp,
			}
		: { status: "unreadable" }
}

async function fetchNav(): Promise<NavClassification> {
	const [state, latest] = await Promise.all([
		readContract(async () => (await navOracle()).state()),
		readContract(async () => (await navOracle()).latest()),
	])

	return classifyNav(state, latest)
}

export function useNavPrice(): {
	nav: NavClassification | undefined
	isPending: boolean
	canEnter: boolean
} {
	const { data, isPending } = useQuery({
		queryKey: ["nav", "latest"],
		queryFn: fetchNav,
		staleTime: 30_000,
	})

	return { nav: data, isPending, canEnter: data?.status === "valid" }
}

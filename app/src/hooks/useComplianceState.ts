import { type Amount, readContract } from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import {
	identityRegistryAt,
	identityVerifierAt,
	shareToken,
} from "../config/clients"
import { identityRegistryOf } from "./useIdentityRegistry"
import { type Allowance, allowanceQuery, fetchAllowance } from "./useIsAllowed"
import { classifyShares } from "./useSharePosition"

export const complianceReadsKey = ["compliance", "reads"] as const

const REFRESH_MS = 15_000

export type TargetReads = {
	allowance: Allowance
	vetoed: boolean | null
	frozen: boolean | null
	shares: Amount | null
	frozenShares: Amount | null
}

export type TargetState =
	| { status: "none" }
	| { status: "checking" }
	| { status: "ready"; reads: TargetReads }

const sharesOf = (position: ReturnType<typeof classifyShares>) =>
	position.status === "held" ? position.shares : null

// The registry the verifier names holds the veto; with no verifier there is none to ask.
async function fetchVetoed(
	verifier: string | null,
	account: string,
): Promise<boolean | null> {
	if (verifier === null) return null
	const read = await readContract(async () =>
		(await identityRegistryAt(await identityRegistryOf(verifier))).is_vetoed({
			account,
		}),
	)
	return read.kind === "value" ? read.value : null
}

async function fetchTargetReads(
	verifier: string | null,
	account: string,
): Promise<TargetReads> {
	const token = shareToken()
	const allowed: Promise<Allowance> =
		verifier === null
			? Promise.resolve("unreadable")
			: fetchAllowance(identityVerifierAt(verifier), account)
	const [allowance, vetoed, frozen, shares, frozenShares] = await Promise.all([
		allowed,
		fetchVetoed(verifier, account),
		readContract(async () =>
			(await token).is_frozen({ user_address: account }),
		),
		readContract(async () => (await token).balance({ account })),
		readContract(async () =>
			(await token).get_frozen_tokens({ user_address: account }),
		),
	])
	return {
		allowance,
		vetoed,
		frozen: frozen.kind === "value" ? frozen.value : null,
		shares: sharesOf(classifyShares(shares)),
		frozenShares: sharesOf(classifyShares(frozenShares)),
	}
}

export function useComplianceState({
	verifier,
	target,
	destination,
}: {
	verifier: string | null
	target: string | undefined
	destination: string | undefined
}): { target: TargetState; destination: Allowance } {
	const { data } = useQuery({
		queryKey: [...complianceReadsKey, verifier, target],
		queryFn:
			target === undefined
				? skipToken
				: () => fetchTargetReads(verifier, target),
		staleTime: 30_000,
		refetchInterval: REFRESH_MS,
	})
	const { data: destinationAllowance } = useQuery(
		allowanceQuery(verifier, destination),
	)

	const targetState: TargetState =
		target === undefined
			? { status: "none" }
			: data === undefined
				? { status: "checking" }
				: { status: "ready", reads: data }
	return {
		target: targetState,
		destination: destinationAllowance ?? "checking",
	}
}

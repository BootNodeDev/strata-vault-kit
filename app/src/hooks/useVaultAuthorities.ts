import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"

export const vaultAuthoritiesKey = ["vault", "authorities"] as const

export type RoleKey = "governance" | "manager" | "treasury" | "guardian"

export type Custodian =
	{ kind: "set"; address: string } | { kind: "unset" } | { kind: "unreadable" }

export type VaultAuthorities = Record<RoleKey, string | null> & {
	custodian: Custodian
}

const toAddress = (read: ContractRead<string | null>): string | null =>
	read.kind === "value" ? read.value : null

const toCustodian = (read: ContractRead<string | null>): Custodian => {
	if (read.kind !== "value") return { kind: "unreadable" }
	return read.value === null
		? { kind: "unset" }
		: { kind: "set", address: read.value }
}

async function fetchVaultAuthorities(): Promise<VaultAuthorities> {
	const [governance, manager, treasury, guardian, custodian] =
		await Promise.all([
			readContract(async () => (await asyncVault()).governance()),
			readContract(async () => (await asyncVault()).manager()),
			readContract(async () => (await asyncVault()).treasury()),
			readContract(async () => (await asyncVault()).guardian()),
			readContract(async () => (await asyncVault()).custodian()),
		])

	return {
		governance: toAddress(governance),
		manager: toAddress(manager),
		treasury: toAddress(treasury),
		guardian: toAddress(guardian),
		custodian: toCustodian(custodian),
	}
}

export function useVaultAuthorities(): {
	authorities: VaultAuthorities | undefined
	isPending: boolean
} {
	const { data, isPending } = useQuery({
		queryKey: vaultAuthoritiesKey,
		queryFn: fetchVaultAuthorities,
		staleTime: 30_000,
	})

	return { authorities: data, isPending }
}

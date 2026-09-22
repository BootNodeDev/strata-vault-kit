import { type ContractRead, readContract } from "@stellar-scaffold/app-lib"
import { useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"

export type AuthorityKey =
	"governance" | "manager" | "treasury" | "guardian" | "custodian"

export type VaultAuthorities = Record<AuthorityKey, string | null>

const toAddress = (read: ContractRead<string | undefined>): string | null =>
	read.kind === "value" ? (read.value ?? null) : null

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
		custodian: toAddress(custodian),
	}
}

export function useVaultAuthorities(): {
	authorities: VaultAuthorities | undefined
	isPending: boolean
} {
	const { data, isPending } = useQuery({
		queryKey: ["vault", "authorities"],
		queryFn: fetchVaultAuthorities,
		staleTime: 30_000,
	})

	return { authorities: data, isPending }
}

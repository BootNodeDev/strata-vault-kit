import {
	connectNavOracle,
	connectShareToken,
	type ContractRead,
	readContract,
} from "@stellar-scaffold/app-lib"
import { skipToken, useQuery } from "@tanstack/react-query"
import { asyncVault } from "../config/clients"
import { useWallet } from "./useWallet"

export type AdminSurface =
	"cycle" | "compliance" | "emergency" | "configuration" | "governance"

export const SURFACE_ORDER: AdminSurface[] = [
	"cycle",
	"compliance",
	"emergency",
	"configuration",
	"governance",
]

export const SURFACE_LABELS: Record<AdminSurface, string> = {
	cycle: "Cycle",
	compliance: "Compliance",
	emergency: "Emergency",
	configuration: "Configuration",
	governance: "Governance",
}

export type AdminAuthorityStatus =
	"disconnected" | "checking" | "unreadable" | "ready"

export interface AdminAddresses {
	oracle: string | null
	shareToken: string | null
	identityVerifier: string | null
}

export interface AdminAuthority {
	status: AdminAuthorityStatus
	surfaces: Set<AdminSurface>
	grantedBy: Record<AdminSurface, string[]>
	roles: string[]
	addresses: AdminAddresses
}

export interface AuthorityReads {
	address: string
	governance: ContractRead<string | null>
	manager: ContractRead<string | null>
	treasury: ContractRead<string | null>
	guardian: ContractRead<string | null>
	oracleAttester: ContractRead<number | null>
	oracleGuardian: ContractRead<number | null>
	tokenCompliance: ContractRead<number | null>
	tokenAdmin: ContractRead<string | null>
}

const emptyGrantedBy = (): Record<AdminSurface, string[]> => ({
	cycle: [],
	compliance: [],
	emergency: [],
	configuration: [],
	governance: [],
})

const emptyAddresses = (): AdminAddresses => ({
	oracle: null,
	shareToken: null,
	identityVerifier: null,
})

const isHeldBy = (
	read: ContractRead<string | null>,
	address: string,
): boolean => read.kind === "value" && read.value === address

const hasRole = (read: ContractRead<number | null>): boolean =>
	read.kind === "value" && read.value !== null

const toRoles = (grantedBy: Record<AdminSurface, string[]>): string[] => {
	const roles: string[] = []
	for (const surface of SURFACE_ORDER) {
		for (const role of grantedBy[surface]) {
			if (!roles.includes(role)) roles.push(role)
		}
	}
	return roles
}

export function toSurfaces(reads: AuthorityReads): {
	surfaces: Set<AdminSurface>
	grantedBy: Record<AdminSurface, string[]>
	roles: string[]
} {
	const grantedBy = emptyGrantedBy()

	if (isHeldBy(reads.manager, reads.address)) {
		grantedBy.cycle.push("vault manager")
	}
	if (isHeldBy(reads.treasury, reads.address)) {
		grantedBy.cycle.push("vault treasury")
	}
	if (hasRole(reads.oracleAttester)) grantedBy.cycle.push("oracle attester")

	if (hasRole(reads.tokenCompliance)) {
		grantedBy.compliance.push("share-token compliance")
	}

	if (isHeldBy(reads.guardian, reads.address)) {
		grantedBy.emergency.push("vault guardian")
	}
	if (hasRole(reads.oracleGuardian)) grantedBy.emergency.push("oracle guardian")
	if (isHeldBy(reads.tokenAdmin, reads.address)) {
		grantedBy.emergency.push("share-token admin")
	}

	if (isHeldBy(reads.governance, reads.address)) {
		grantedBy.configuration.push("vault governance")
		grantedBy.governance.push("vault governance")
	}

	const surfaces = new Set<AdminSurface>(
		SURFACE_ORDER.filter((surface) => grantedBy[surface].length > 0),
	)
	return { surfaces, grantedBy, roles: toRoles(grantedBy) }
}

const isUnreadable = (read: ContractRead<unknown>): boolean =>
	read.kind !== "value"

const isValue = <T>(
	read: ContractRead<T>,
): read is { kind: "value"; value: T } => read.kind === "value"

const toAddressOrNull = (read: ContractRead<string>): string | null =>
	read.kind === "value" ? read.value : null

interface AdminAuthorityFetchResult {
	status: "unreadable" | "ready"
	surfaces: Set<AdminSurface>
	grantedBy: Record<AdminSurface, string[]>
	roles: string[]
	addresses: AdminAddresses
}

async function fetchAdminAuthority(
	address: string,
): Promise<AdminAuthorityFetchResult> {
	const [
		governance,
		manager,
		treasury,
		guardian,
		oracleAddress,
		shareTokenAddress,
	] = await Promise.all([
		readContract(async () => (await asyncVault()).governance()),
		readContract(async () => (await asyncVault()).manager()),
		readContract(async () => (await asyncVault()).treasury()),
		readContract(async () => (await asyncVault()).guardian()),
		readContract(async () => (await asyncVault()).oracle()),
		readContract(async () => (await asyncVault()).share_token()),
	])

	if (!isValue(oracleAddress) || !isValue(shareTokenAddress)) {
		return {
			status: "unreadable",
			surfaces: new Set(),
			grantedBy: emptyGrantedBy(),
			roles: [],
			addresses: {
				oracle: toAddressOrNull(oracleAddress),
				shareToken: toAddressOrNull(shareTokenAddress),
				identityVerifier: null,
			},
		}
	}

	const oraclePromise = connectNavOracle(oracleAddress.value)
	const tokenPromise = connectShareToken(shareTokenAddress.value)

	const [
		oracleAttester,
		oracleGuardian,
		tokenCompliance,
		tokenAdmin,
		identityVerifier,
	] = await Promise.all([
		readContract(async () =>
			(await oraclePromise).has_role({ account: address, role: "attester" }),
		),
		readContract(async () =>
			(await oraclePromise).has_role({ account: address, role: "guardian" }),
		),
		readContract(async () =>
			(await tokenPromise).has_role({
				account: address,
				role: "compliance",
			}),
		),
		readContract(async () => (await tokenPromise).get_admin()),
		readContract(async () => (await tokenPromise).identity_verifier()),
	])

	const addresses: AdminAddresses = {
		oracle: oracleAddress.value,
		shareToken: shareTokenAddress.value,
		identityVerifier: toAddressOrNull(identityVerifier),
	}

	const roleReads = [
		governance,
		manager,
		treasury,
		guardian,
		oracleAttester,
		oracleGuardian,
		tokenCompliance,
		tokenAdmin,
	]
	if (roleReads.some(isUnreadable)) {
		return {
			status: "unreadable",
			surfaces: new Set(),
			grantedBy: emptyGrantedBy(),
			roles: [],
			addresses,
		}
	}

	const { surfaces, grantedBy, roles } = toSurfaces({
		address,
		governance,
		manager,
		treasury,
		guardian,
		oracleAttester,
		oracleGuardian,
		tokenCompliance,
		tokenAdmin,
	})

	return { status: "ready", surfaces, grantedBy, roles, addresses }
}

export function useAdminAuthority(): AdminAuthority {
	const { address } = useWallet()
	const { data } = useQuery({
		queryKey: ["admin", "authority", address],
		queryFn:
			address === undefined ? skipToken : () => fetchAdminAuthority(address),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	})

	if (address === undefined) {
		return {
			status: "disconnected",
			surfaces: new Set(),
			grantedBy: emptyGrantedBy(),
			roles: [],
			addresses: emptyAddresses(),
		}
	}

	return (
		data ?? {
			status: "checking",
			surfaces: new Set(),
			grantedBy: emptyGrantedBy(),
			roles: [],
			addresses: emptyAddresses(),
		}
	)
}

import {
	type AccountSigners,
	accountSigners,
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

export type Standing =
	"signs-alone" | { needs: number } | { weight: number; threshold: number }

export interface Grant {
	role: string
	authority: string
	standing: Standing
}

export interface AdminAuthority {
	status: AdminAuthorityStatus
	surfaces: Set<AdminSurface>
	grantedBy: Record<AdminSurface, Grant[]>
	grants: Grant[]
	signersUnknown: boolean
	addresses: AdminAddresses
}

const ROLE_SURFACES = {
	"vault manager": ["cycle"],
	"vault treasury": ["cycle"],
	"oracle attester": ["cycle"],
	"share-token compliance": ["compliance"],
	"vault guardian": ["emergency"],
	"oracle guardian": ["emergency"],
	"share-token admin": ["emergency"],
	"vault governance": ["configuration", "governance"],
} as const satisfies Record<string, readonly AdminSurface[]>

type RoleLabel = keyof typeof ROLE_SURFACES

export type RoleHolders = Record<RoleLabel, string[]>

const ROLE_LABELS = Object.keys(ROLE_SURFACES) as RoleLabel[]

const emptyGrantedBy = (): Record<AdminSurface, Grant[]> => ({
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

const emptyAuthority = (
	status: AdminAuthorityStatus,
	addresses = emptyAddresses(),
): AdminAuthority => ({
	status,
	surfaces: new Set(),
	grantedBy: emptyGrantedBy(),
	grants: [],
	signersUnknown: false,
	addresses,
})

const toGrants = (grantedBy: Record<AdminSurface, Grant[]>): Grant[] => {
	const grants: Grant[] = []
	for (const surface of SURFACE_ORDER) {
		for (const grant of grantedBy[surface]) {
			if (!grants.includes(grant)) grants.push(grant)
		}
	}
	return grants
}

const standingOf = (
	wallet: string,
	holder: string,
	signers: AccountSigners | undefined,
): Standing | null => {
	if (signers === undefined) return wallet === holder ? "signs-alone" : null
	const weight = signers.signers.find(({ key }) => key === wallet)?.weight
	if (weight === undefined || weight === 0) return null
	const threshold = signers.thresholds.med
	if (weight >= threshold) return "signs-alone"
	const everySignerWeighsOne = signers.signers.every(
		({ weight: other }) => other <= 1,
	)
	return everySignerWeighsOne ? { needs: threshold } : { weight, threshold }
}

export function toSurfaces(
	wallet: string,
	holders: RoleHolders,
	signersByAccount: Record<string, AccountSigners>,
): {
	surfaces: Set<AdminSurface>
	grantedBy: Record<AdminSurface, Grant[]>
	grants: Grant[]
} {
	const grantedBy = emptyGrantedBy()

	for (const role of ROLE_LABELS) {
		for (const authority of holders[role]) {
			const standing = standingOf(
				wallet,
				authority,
				signersByAccount[authority],
			)
			if (standing === null) continue
			const grant: Grant = { role, authority, standing }
			for (const surface of ROLE_SURFACES[role]) grantedBy[surface].push(grant)
		}
	}

	const surfaces = new Set<AdminSurface>(
		SURFACE_ORDER.filter((surface) => grantedBy[surface].length > 0),
	)
	return { surfaces, grantedBy, grants: toGrants(grantedBy) }
}

const isUnreadable = (read: ContractRead<unknown>): boolean =>
	read.kind !== "value"

const isValue = <T>(
	read: ContractRead<T>,
): read is { kind: "value"; value: T } => read.kind === "value"

const toAddressOrNull = (read: ContractRead<string>): string | null =>
	read.kind === "value" ? read.value : null

type ReadCall<T> = Parameters<typeof readContract<T>>[0]

interface RoleMemberClient {
	get_role_member_count(args: { role: string }): ReturnType<ReadCall<number>>
	get_role_member(args: {
		role: string
		index: number
	}): ReturnType<ReadCall<string>>
}

async function readRoleMembers(
	client: Promise<RoleMemberClient>,
	role: string,
): Promise<ContractRead<string[]>> {
	const count = await readContract(async () =>
		(await client).get_role_member_count({ role }),
	)
	if (!isValue(count)) return count

	const reads = await Promise.all(
		Array.from({ length: count.value }, (_, index) =>
			readContract(async () => (await client).get_role_member({ role, index })),
		),
	)
	const members: string[] = []
	for (const read of reads) {
		if (!isValue(read)) return read
		members.push(read.value)
	}
	return { kind: "value", value: members }
}

const asHolders = (read: ContractRead<string | null>): string[] =>
	read.kind === "value" && read.value !== null ? [read.value] : []

const asMembers = (read: ContractRead<string[]>): string[] =>
	read.kind === "value" ? read.value : []

async function readSigners(
	holders: RoleHolders,
): Promise<{ byAccount: Record<string, AccountSigners>; unknown: boolean }> {
	const accounts = new Set<string>()
	for (const role of ROLE_LABELS) {
		for (const holder of holders[role]) {
			if (holder.startsWith("G")) accounts.add(holder)
		}
	}

	const byAccount: Record<string, AccountSigners> = {}
	let unknown = false
	const results = await Promise.all(
		[...accounts].map(async (account) => ({
			account,
			signers: await accountSigners(account),
		})),
	)
	for (const { account, signers } of results) {
		if (signers === null) unknown = true
		else byAccount[account] = signers
	}
	return { byAccount, unknown }
}

async function fetchAdminAuthority(wallet: string): Promise<AdminAuthority> {
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
		return emptyAuthority("unreadable", {
			oracle: toAddressOrNull(oracleAddress),
			shareToken: toAddressOrNull(shareTokenAddress),
			identityVerifier: null,
		})
	}

	const oraclePromise = connectNavOracle(oracleAddress.value)
	const tokenPromise = connectShareToken(shareTokenAddress.value)

	const [
		oracleAttesters,
		oracleGuardians,
		tokenCompliance,
		tokenAdmin,
		identityVerifier,
	] = await Promise.all([
		readRoleMembers(oraclePromise, "attester"),
		readRoleMembers(oraclePromise, "guardian"),
		readRoleMembers(tokenPromise, "compliance"),
		readContract(async () => (await tokenPromise).get_admin()),
		readContract(async () => (await tokenPromise).identity_verifier()),
	])

	const addresses: AdminAddresses = {
		oracle: oracleAddress.value,
		shareToken: shareTokenAddress.value,
		identityVerifier: toAddressOrNull(identityVerifier),
	}

	const roleReads: ContractRead<unknown>[] = [
		governance,
		manager,
		treasury,
		guardian,
		oracleAttesters,
		oracleGuardians,
		tokenCompliance,
		tokenAdmin,
	]
	if (roleReads.some(isUnreadable))
		return emptyAuthority("unreadable", addresses)

	const holders: RoleHolders = {
		"vault governance": asHolders(governance),
		"vault manager": asHolders(manager),
		"vault treasury": asHolders(treasury),
		"vault guardian": asHolders(guardian),
		"oracle attester": asMembers(oracleAttesters),
		"oracle guardian": asMembers(oracleGuardians),
		"share-token compliance": asMembers(tokenCompliance),
		"share-token admin": asHolders(tokenAdmin),
	}
	const { byAccount, unknown } = await readSigners(holders)

	return {
		status: "ready",
		...toSurfaces(wallet, holders, byAccount),
		signersUnknown: unknown,
		addresses,
	}
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

	if (address === undefined) return emptyAuthority("disconnected")
	return data ?? emptyAuthority("checking")
}

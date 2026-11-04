import {
	type AccountSigners,
	accountSigners,
	connectNavOracle,
	connectShareToken,
	type ContractRead,
	type PendingAdmins,
	readContract,
	readContractAdmin,
	requiredWeight,
	type ShareTokenApi,
	uniformWeights,
} from "@stellar-scaffold/app-lib"
import {
	type QueryClient,
	skipToken,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query"
import { useMemo } from "react"
import { addresses as configured } from "../config/addresses"
import { asyncVault, navOracle, shareToken } from "../config/clients"
import { vaultContractId } from "../config/contracts"
import { pendingAdminsQuery } from "./pendingAdmins"
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
	signersLoading: boolean
	verifierAdminUnknown: boolean
	addresses: AdminAddresses
	holders: RoleHolders
}

const ROLE_SURFACES = {
	"vault manager": ["cycle"],
	"vault treasury": ["cycle"],
	"oracle attester": ["cycle"],
	"share-token compliance": ["compliance"],
	"identity-verifier admin": ["compliance"],
	"vault guardian": ["emergency"],
	"oracle guardian": ["emergency"],
	"share-token manager": [],
	"share-token admin": ["emergency", "configuration", "governance"],
	"oracle admin": ["emergency", "configuration", "governance"],
	"vault governance": ["emergency", "configuration", "governance"],
	"vault pending admin": ["governance"],
	"oracle pending admin": ["governance"],
	"share-token pending admin": ["governance"],
} as const satisfies Record<string, readonly AdminSurface[]>

type RoleLabel = keyof typeof ROLE_SURFACES

export type RoleHolders = Record<RoleLabel, string[]>

const ROLE_LABELS = Object.keys(ROLE_SURFACES) as RoleLabel[]

const emptyHolders = (): RoleHolders => ({
	"vault manager": [],
	"vault treasury": [],
	"oracle attester": [],
	"share-token compliance": [],
	"identity-verifier admin": [],
	"vault guardian": [],
	"oracle guardian": [],
	"share-token manager": [],
	"share-token admin": [],
	"oracle admin": [],
	"vault governance": [],
	"vault pending admin": [],
	"oracle pending admin": [],
	"share-token pending admin": [],
})

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
	signersLoading: false,
	verifierAdminUnknown: false,
	addresses,
	holders: emptyHolders(),
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
	const threshold = requiredWeight(signers)
	if (weight >= threshold) return "signs-alone"
	return uniformWeights(signers.signers)
		? { needs: threshold }
		: { weight, threshold }
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

const pendingAdminOf = (
	pendingAdmins: PendingAdmins | undefined,
	contract: string,
): string[] => {
	const transfer = pendingAdmins?.pending.get(contract)
	return transfer === undefined || transfer === null || transfer.expired
		? []
		: [transfer.address]
}

const signerAccounts = (holders: RoleHolders): string[] => {
	const accounts = new Set<string>()
	for (const role of ROLE_LABELS) {
		for (const holder of holders[role]) {
			if (holder.startsWith("G")) accounts.add(holder)
		}
	}
	return [...accounts]
}

async function readSigners(
	accounts: string[],
): Promise<{ byAccount: Record<string, AccountSigners>; unknown: boolean }> {
	const byAccount: Record<string, AccountSigners> = {}
	let unknown = false
	const results = await Promise.all(
		accounts.map(async (account) => ({
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

type VerifierRead = {
	address: ContractRead<string>
	admin: ContractRead<string | null> | undefined
}

async function readVerifier(
	token: Promise<ShareTokenApi>,
): Promise<VerifierRead> {
	const address = await readContract(async () =>
		(await token).identity_verifier(),
	)
	return {
		address,
		admin: isValue(address)
			? await readContractAdmin(address.value)
			: undefined,
	}
}

type HoldersRead =
	| { status: "unreadable"; addresses: AdminAddresses }
	| {
			status: "ready"
			addresses: AdminAddresses
			holders: RoleHolders
			verifierAdminUnknown: boolean
	  }

const oracleReader = (address: string) =>
	address === configured.nav_oracle ? navOracle() : connectNavOracle(address)

const tokenReader = (address: string) =>
	address === configured.share_token ? shareToken() : connectShareToken(address)

async function fetchHolders(queryClient: QueryClient): Promise<HoldersRead> {
	const [
		governance,
		manager,
		treasury,
		guardian,
		oracleAddress,
		shareTokenAddress,
	] = await Promise.all([
		readContract(async () => (await asyncVault()).governance()),
		readRoleMembers(asyncVault(), "manager"),
		readRoleMembers(asyncVault(), "treasury"),
		readRoleMembers(asyncVault(), "guardian"),
		readContract(async () => (await asyncVault()).oracle()),
		readContract(async () => (await asyncVault()).share_token()),
	])

	if (!isValue(oracleAddress) || !isValue(shareTokenAddress)) {
		return {
			status: "unreadable",
			addresses: {
				oracle: toAddressOrNull(oracleAddress),
				shareToken: toAddressOrNull(shareTokenAddress),
				identityVerifier: null,
			},
		}
	}

	const oraclePromise = oracleReader(oracleAddress.value)
	const tokenPromise = tokenReader(shareTokenAddress.value)

	const [
		oracleAttesters,
		oracleGuardians,
		oracleAdmin,
		tokenCompliance,
		tokenManager,
		tokenAdmin,
		verifier,
		pendingAdmins,
	] = await Promise.all([
		readRoleMembers(oraclePromise, "attester"),
		readRoleMembers(oraclePromise, "guardian"),
		readContract(async () => (await oraclePromise).get_admin()),
		readRoleMembers(tokenPromise, "compliance"),
		readRoleMembers(tokenPromise, "manager"),
		readContract(async () => (await tokenPromise).get_admin()),
		readVerifier(tokenPromise),
		queryClient
			.fetchQuery(
				pendingAdminsQuery({
					vault: vaultContractId,
					oracle: oracleAddress.value,
					token: shareTokenAddress.value,
				}),
			)
			.catch(() => undefined),
	])

	const addresses: AdminAddresses = {
		oracle: oracleAddress.value,
		shareToken: shareTokenAddress.value,
		identityVerifier: toAddressOrNull(verifier.address),
	}

	const roleReads: ContractRead<unknown>[] = [
		governance,
		manager,
		treasury,
		guardian,
		oracleAttesters,
		oracleGuardians,
		oracleAdmin,
		tokenCompliance,
		tokenManager,
		tokenAdmin,
	]
	if (roleReads.some(isUnreadable)) return { status: "unreadable", addresses }

	const holders: RoleHolders = {
		"vault governance": asHolders(governance),
		"vault manager": asMembers(manager),
		"vault treasury": asMembers(treasury),
		"vault guardian": asMembers(guardian),
		"oracle attester": asMembers(oracleAttesters),
		"oracle guardian": asMembers(oracleGuardians),
		"oracle admin": asHolders(oracleAdmin),
		"share-token compliance": asMembers(tokenCompliance),
		"identity-verifier admin":
			verifier.admin === undefined ? [] : asHolders(verifier.admin),
		"share-token manager": asMembers(tokenManager),
		"share-token admin": asHolders(tokenAdmin),
		"vault pending admin": pendingAdminOf(pendingAdmins, vaultContractId),
		"oracle pending admin": pendingAdminOf(pendingAdmins, oracleAddress.value),
		"share-token pending admin": pendingAdminOf(
			pendingAdmins,
			shareTokenAddress.value,
		),
	}

	return {
		status: "ready",
		addresses,
		holders,
		verifierAdminUnknown:
			verifier.admin === undefined || !isValue(verifier.admin),
	}
}

export const adminAuthorityKey = ["admin", "authority"] as const

export function useAdminAuthority(): AdminAuthority {
	const { address } = useWallet()
	const queryClient = useQueryClient()
	const { data } = useQuery({
		queryKey: [...adminAuthorityKey, "holders"],
		queryFn:
			address === undefined ? skipToken : () => fetchHolders(queryClient),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	})
	const accounts = data?.status === "ready" ? signerAccounts(data.holders) : []
	const { data: signers } = useQuery({
		queryKey: [...adminAuthorityKey, "signers", accounts],
		queryFn: data?.status === "ready" ? () => readSigners(accounts) : skipToken,
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	})

	return useMemo(() => {
		if (address === undefined) return emptyAuthority("disconnected")
		if (data === undefined) return emptyAuthority("checking")
		if (data.status === "unreadable")
			return emptyAuthority("unreadable", data.addresses)
		return {
			status: "ready",
			...toSurfaces(address, data.holders, signers?.byAccount ?? {}),
			signersUnknown: signers?.unknown ?? false,
			signersLoading: signers === undefined,
			verifierAdminUnknown: data.verifierAdminUnknown,
			addresses: data.addresses,
			holders: data.holders,
		}
	}, [address, data, signers])
}

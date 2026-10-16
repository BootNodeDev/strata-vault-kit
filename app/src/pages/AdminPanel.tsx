import { shortAddress } from "@stellar-scaffold/app-lib"
import React, { useEffect, useRef } from "react"
import { Navigate, useParams } from "react-router-dom"
import ComplianceSection from "../components/admin/ComplianceSection"
import ConfigurationSection from "../components/admin/ConfigurationSection"
import CycleSection from "../components/admin/CycleSection"
import Disclosure from "../components/admin/Disclosure"
import EmergencySection from "../components/admin/EmergencySection"
import GovernanceSection from "../components/admin/GovernanceSection"
import SurfaceTabs from "../components/admin/SurfaceTabs"
import Skeleton from "../components/Skeleton"
import AddressRows, { type AddressRow } from "../components/vault/AddressRows"
import { vaultContractId } from "../config/contracts"
import {
	type AdminAddresses,
	type AdminSurface,
	type Grant,
	type RoleHolders,
	type Standing,
	SURFACE_LABELS,
	SURFACE_ORDER,
	useAdminAuthority,
} from "../hooks/useAdminAuthority"
import { useWallet } from "../hooks/useWallet"
import typeStyles from "../styles/type.module.css"
import styles from "./AdminPanel.module.css"

const toAddressRows = (addresses: AdminAddresses): AddressRow[] => [
	{ label: "Vault", address: vaultContractId },
	{ label: "Share token", address: addresses.shareToken },
	{ label: "Oracle", address: addresses.oracle },
	{ label: "Identity verifier", address: addresses.identityVerifier },
]

const describeStanding = (standing: Standing): string => {
	if (standing === "signs-alone") return "signs alone"
	if ("needs" in standing) return `1 of ${standing.needs} signatures`
	return `weight ${standing.weight} of threshold ${standing.threshold}`
}

const isSingleKey = (grant: Grant, wallet: string): boolean =>
	grant.authority === wallet && grant.standing === "signs-alone"

const titleCase = (text: string): string =>
	text.replace(
		/(^|[\s-])(\w)/g,
		(_, gap: string, letter: string) => `${gap}${letter.toUpperCase()}`,
	)

const describeGrant = (grant: Grant, wallet: string): string =>
	isSingleKey(grant, wallet)
		? titleCase(grant.role)
		: `${titleCase(grant.role)} (${describeStanding(grant.standing)})`

const describeRoles = (grants: Grant[], wallet: string): string =>
	`${grants.length === 1 ? "Current role" : "Current roles"}: ${grants
		.map((grant) => describeGrant(grant, wallet))
		.join(" · ")}`

const Contracts: React.FC<{ addresses: AdminAddresses }> = ({ addresses }) => (
	<Disclosure title="Contracts">
		<AddressRows rows={toAddressRows(addresses)} />
	</Disclosure>
)

const SurfaceBody: React.FC<{
	surface: AdminSurface
	active: boolean
	grantedBy: Record<AdminSurface, Grant[]>
	wallet: string
	addresses: AdminAddresses
	holders: RoleHolders
	verifierAdminUnknown: boolean
}> = ({
	surface,
	active,
	grantedBy,
	wallet,
	addresses,
	holders,
	verifierAdminUnknown,
}) => {
	const contracts = <Contracts addresses={addresses} />
	switch (surface) {
		case "cycle":
			return (
				<CycleSection
					grants={grantedBy.cycle}
					wallet={wallet}
					active={active}
					contracts={contracts}
				/>
			)
		case "emergency":
			return (
				<EmergencySection
					grants={grantedBy.emergency}
					wallet={wallet}
					active={active}
					contracts={contracts}
				/>
			)
		case "configuration":
			return (
				<ConfigurationSection
					grants={grantedBy.configuration}
					wallet={wallet}
					active={active}
					contracts={contracts}
				/>
			)
		case "governance":
			return (
				<GovernanceSection
					grants={grantedBy.governance}
					wallet={wallet}
					holders={holders}
					addresses={addresses}
					active={active}
					contracts={contracts}
				/>
			)
		case "compliance":
			return (
				<ComplianceSection
					grants={grantedBy.compliance}
					wallet={wallet}
					addresses={addresses}
					verifierAdminUnknown={verifierAdminUnknown}
					active={active}
					contracts={contracts}
				/>
			)
	}
}

const HeldSurfaces: React.FC<{
	held: AdminSurface[]
	grantedBy: Record<AdminSurface, Grant[]>
	wallet: string
	addresses: AdminAddresses
	holders: RoleHolders
	verifierAdminUnknown: boolean
}> = ({
	held,
	grantedBy,
	wallet,
	addresses,
	holders,
	verifierAdminUnknown,
}) => {
	const { surface } = useParams()
	const active = held.find((candidate) => candidate === surface)
	const headingRef = useRef<HTMLHeadingElement>(null)
	const shownSurface = useRef<AdminSurface | undefined>(undefined)

	useEffect(() => {
		if (active === undefined) return
		const previous = shownSurface.current
		if (
			previous !== undefined &&
			previous !== active &&
			held.includes(previous)
		) {
			headingRef.current?.focus()
		}
		shownSurface.current = active
	}, [active, held])

	if (active === undefined) return <Navigate replace to={`/admin/${held[0]}`} />

	return (
		<div className={styles.surfaces}>
			<SurfaceTabs surfaces={held} />
			{held.map((surface) => (
				<section
					key={surface}
					aria-label={SURFACE_LABELS[surface]}
					hidden={surface !== active}
					className={styles.surface}
				>
					<h2
						ref={surface === active ? headingRef : undefined}
						tabIndex={-1}
						className={styles.srOnly}
					>
						{SURFACE_LABELS[surface]}
					</h2>
					<SurfaceBody
						surface={surface}
						active={surface === active}
						grantedBy={grantedBy}
						wallet={wallet}
						addresses={addresses}
						holders={holders}
						verifierAdminUnknown={verifierAdminUnknown}
					/>
				</section>
			))}
		</div>
	)
}

const AdminPanel: React.FC = () => {
	const {
		status,
		surfaces,
		grantedBy,
		grants,
		signersUnknown,
		verifierAdminUnknown,
		addresses,
		holders,
	} = useAdminAuthority()
	const { address } = useWallet()
	const held = SURFACE_ORDER.filter((surface) => surfaces.has(surface))

	return (
		<div className={styles.page}>
			<h1 className={typeStyles.sectionHead}>Operations Console</h1>

			{status === "ready" && address !== undefined && (
				<p className={typeStyles.footnote}>
					{shortAddress(address)}
					{grants.length > 0 ? ` · ${describeRoles(grants, address)}` : ""}
				</p>
			)}

			{status === "ready" && signersUnknown && (
				<p className={typeStyles.footnote}>Signer lookup unavailable.</p>
			)}

			{status === "disconnected" && (
				<p className={typeStyles.body}>
					Connect a wallet to operate this vault.
				</p>
			)}

			{status === "checking" && (
				<div className={styles.pending}>
					<Skeleton className={styles.pendingLine} />
					<Skeleton className={styles.pendingLine} />
				</div>
			)}

			{status === "unreadable" && (
				<p className={typeStyles.body}>
					Could not read the vault's authorities.
				</p>
			)}

			{status === "ready" && held.length === 0 && (
				<>
					<p className={typeStyles.body}>
						This address holds no authority on this vault.
					</p>
					<Contracts addresses={addresses} />
				</>
			)}

			{status === "ready" && held.length > 0 && (
				<HeldSurfaces
					held={held}
					grantedBy={grantedBy}
					wallet={address ?? ""}
					addresses={addresses}
					holders={holders}
					verifierAdminUnknown={verifierAdminUnknown}
				/>
			)}
		</div>
	)
}

export default AdminPanel

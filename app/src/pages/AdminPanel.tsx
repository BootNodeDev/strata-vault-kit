import { shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import CycleSection from "../components/admin/CycleSection"
import Skeleton from "../components/Skeleton"
import AddressRows, { type AddressRow } from "../components/vault/AddressRows"
import { vaultContractId } from "../config/contracts"
import {
	type AdminAddresses,
	type Grant,
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

const describeGrant = (grant: Grant, wallet: string): string =>
	isSingleKey(grant, wallet)
		? grant.role
		: `${grant.role} (${describeStanding(grant.standing)})`

const describeCardGrant = (grant: Grant, wallet: string): string =>
	isSingleKey(grant, wallet)
		? grant.role
		: `${grant.role} — ${describeStanding(grant.standing)}`

const AddressesBlock: React.FC<{ addresses: AdminAddresses }> = ({
	addresses,
}) => (
	<div className={styles.addresses}>
		<span className={`${typeStyles.label} ${styles.addressesTitle}`}>
			Addresses
		</span>
		<AddressRows rows={toAddressRows(addresses)} />
	</div>
)

const AdminPanel: React.FC = () => {
	const { status, surfaces, grantedBy, grants, signersUnknown, addresses } =
		useAdminAuthority()
	const { address } = useWallet()

	return (
		<div className={styles.page}>
			<h1 className={typeStyles.sectionHead}>Admin</h1>

			{status === "ready" && address !== undefined && (
				<p className={typeStyles.footnote}>
					{shortAddress(address)}
					{grants.length > 0
						? ` · ${grants.map((grant) => describeGrant(grant, address)).join(" · ")}`
						: ""}
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
				<ul className={styles.cards}>
					<li className={styles.card}>
						<Skeleton className={styles.cardSkeleton} />
					</li>
					<li className={styles.card}>
						<Skeleton className={styles.cardSkeleton} />
					</li>
				</ul>
			)}

			{status === "unreadable" && (
				<p className={typeStyles.body}>
					Could not read the vault's authorities.
				</p>
			)}

			{status === "ready" && surfaces.size === 0 && (
				<p className={typeStyles.body}>
					This address holds no authority on this vault.
				</p>
			)}

			{status === "ready" && surfaces.size > 0 && (
				<ul className={styles.cards}>
					{SURFACE_ORDER.filter((surface) => surfaces.has(surface)).map(
						(surface) => (
							<li
								className={`${styles.card} ${surface === "cycle" ? styles.cardWide : ""}`}
								key={surface}
							>
								<h2
									className={`${typeStyles.sectionHead} ${styles.cardHeading}`}
								>
									{SURFACE_LABELS[surface]}
								</h2>
								<span className={`${typeStyles.footnote} ${styles.cardNote}`}>
									Granted by{" "}
									{grantedBy[surface]
										.map((grant) => describeCardGrant(grant, address ?? ""))
										.join(", ")}
								</span>
								{surface === "cycle" && (
									<CycleSection
										grants={grantedBy[surface]}
										wallet={address ?? ""}
									/>
								)}
							</li>
						),
					)}
				</ul>
			)}

			{status === "ready" && <AddressesBlock addresses={addresses} />}
		</div>
	)
}

export default AdminPanel

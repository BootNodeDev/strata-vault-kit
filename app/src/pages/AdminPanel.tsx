import { shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import Skeleton from "../components/Skeleton"
import AddressRows, { type AddressRow } from "../components/vault/AddressRows"
import { vaultContractId } from "../config/contracts"
import {
	type AdminAddresses,
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
	const { status, surfaces, grantedBy, roles, addresses } = useAdminAuthority()
	const { address } = useWallet()

	return (
		<div className={styles.page}>
			<h1 className={typeStyles.sectionHead}>Admin</h1>

			{status === "ready" && address !== undefined && (
				<p className={typeStyles.footnote}>
					{shortAddress(address)}
					{roles.length > 0 ? ` · ${roles.join(" · ")}` : ""}
				</p>
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
							<li className={styles.card} key={surface}>
								<h2
									className={`${typeStyles.sectionHead} ${styles.cardHeading}`}
								>
									{SURFACE_LABELS[surface]}
								</h2>
								<span className={`${typeStyles.footnote} ${styles.cardNote}`}>
									Granted by {grantedBy[surface].join(", ")}
								</span>
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

import { shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./AddressList.module.css"

export type AddressRow =
	| { label: string; source: "config"; address: string }
	| { label: string; source: "placeholder" }

export type AddressGroup = {
	title: string
	rows: AddressRow[]
}

type AddressListProps = {
	groups: AddressGroup[]
}

const COPY_ACKNOWLEDGEMENT_MS = 1500

const AddressList: React.FC<AddressListProps> = ({ groups }) => {
	const [copiedLabel, setCopiedLabel] = React.useState<string | null>(null)

	const copyRow = async (row: { label: string; address: string }) => {
		try {
			await navigator.clipboard.writeText(row.address)
			setCopiedLabel(row.label)
			setTimeout(() => {
				setCopiedLabel((current) => (current === row.label ? null : current))
			}, COPY_ACKNOWLEDGEMENT_MS)
		} catch {
			// Clipboard permission is the reader's to refuse.
		}
	}

	return (
		<section className={styles.list}>
			<h2 className={typeStyles.sectionHead}>Addresses</h2>
			{groups.map((group) => (
				<div className={styles.group} key={group.title}>
					<h3 className={`${typeStyles.label} ${styles.groupTitle}`}>
						{group.title}
					</h3>
					<ul className={styles.rows}>
						{group.rows.map((row) => (
							<li className={styles.row} key={row.label}>
								<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
									{row.label}
								</span>
								{row.source === "config" ? (
									<>
										<span
											className={`${typeStyles.railValue} ${styles.rowValue}`}
										>
											{shortAddress(row.address)}
										</span>
										<button
											type="button"
											className={`${typeStyles.label} ${styles.copyButton}`}
											onClick={() => copyRow(row)}
										>
											{copiedLabel === row.label ? "Copied" : "Copy"}
										</button>
									</>
								) : (
									<span
										className={`${typeStyles.railValue} ${styles.placeholder}`}
									>
										Not read from the vault
									</span>
								)}
							</li>
						))}
					</ul>
				</div>
			))}
		</section>
	)
}

export default AddressList

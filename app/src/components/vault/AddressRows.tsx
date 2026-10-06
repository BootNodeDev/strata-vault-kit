import { explorerContract, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import ExternalLink from "../icons/ExternalLink"
import Skeleton from "../Skeleton"
import styles from "./AddressRows.module.css"

export type AddressRow = {
	label: string
	address: string | null
	pending?: boolean
}

const AddressRows: React.FC<{ rows: AddressRow[] }> = ({ rows }) => (
	<ul className={styles.rows}>
		{rows.map((row) => {
			const explorer =
				row.address === null ? null : explorerContract(row.address)
			return (
				<li className={styles.row} key={row.label}>
					<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
						{row.label}
					</span>
					{row.pending ? (
						<Skeleton
							className={`${typeStyles.railValue} ${styles.rowSkeleton}`}
						/>
					) : row.address === null ? (
						<span className={`${typeStyles.railValue} ${styles.placeholder}`}>
							Unavailable
						</span>
					) : explorer === null ? (
						<span className={`${typeStyles.railValue} ${styles.rowValue}`}>
							{shortAddress(row.address)}
						</span>
					) : (
						<a
							className={`${typeStyles.railValue} ${styles.rowLink}`}
							href={explorer}
							target="_blank"
							rel="noreferrer"
						>
							{shortAddress(row.address)}
							<ExternalLink className={styles.rowIcon} />
						</a>
					)}
				</li>
			)
		})}
	</ul>
)

export default AddressRows

import { explorerContract, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import ExternalLink from "../icons/ExternalLink"
import styles from "./AboutVault.module.css"

export type AddressRow =
	| { label: string; source: "config"; address: string }
	| { label: string; source: "placeholder" }

export type AddressGroup = {
	title: string
	rows: AddressRow[]
}

type AboutVaultProps = {
	summary: string[]
	groups: AddressGroup[]
}

const AboutVault: React.FC<AboutVaultProps> = ({ summary, groups }) => (
	<section className={styles.about}>
		<h2 className={typeStyles.sectionHead}>About this vault</h2>
		<div className={styles.prose}>
			{summary.map((paragraph) => (
				<p className={`${typeStyles.body} ${styles.summary}`} key={paragraph}>
					{paragraph}
				</p>
			))}
		</div>
		{groups.map((group) => (
			<div className={styles.group} key={group.title}>
				<span className={`${typeStyles.label} ${styles.groupTitle}`}>
					{group.title}
				</span>
				<ul className={styles.rows}>
					{group.rows.map((row) => {
						const explorer =
							row.source === "config" ? explorerContract(row.address) : null
						return (
							<li className={styles.row} key={row.label}>
								<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
									{row.label}
								</span>
								{row.source === "placeholder" ? (
									<span
										className={`${typeStyles.railValue} ${styles.placeholder}`}
									>
										Not read yet
									</span>
								) : explorer === null ? (
									<span
										className={`${typeStyles.railValue} ${styles.rowValue}`}
									>
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
			</div>
		))}
	</section>
)

export default AboutVault

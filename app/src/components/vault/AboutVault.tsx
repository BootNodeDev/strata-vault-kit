import { explorerContract, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import ExternalLink from "../icons/ExternalLink"
import Skeleton from "../Skeleton"
import styles from "./AboutVault.module.css"

export type AddressRow = {
	label: string
	address: string | null
	pending?: boolean
}

export type AddressGroup = {
	title: string
	rows: AddressRow[]
}

export type FigureRow = {
	label: string
	value: string | null
	pending?: boolean
}

export type FigureGroup = {
	title: string
	rows: FigureRow[]
}

type AboutVaultProps = {
	summary: string[]
	figures: FigureGroup
	groups: AddressGroup[]
}

const AboutVault: React.FC<AboutVaultProps> = ({
	summary,
	figures,
	groups,
}) => (
	<section className={styles.about}>
		<h2 className={typeStyles.sectionHead}>About this vault</h2>
		<div className={styles.prose}>
			{summary.map((paragraph) => (
				<p className={`${typeStyles.body} ${styles.summary}`} key={paragraph}>
					{paragraph}
				</p>
			))}
		</div>
		<div className={styles.group}>
			<span className={`${typeStyles.label} ${styles.groupTitle}`}>
				{figures.title}
			</span>
			<ul className={styles.rows}>
				{figures.rows.map((row) => (
					<li className={styles.row} key={row.label}>
						<span className={`${typeStyles.footnote} ${styles.rowLabel}`}>
							{row.label}
						</span>
						{row.pending ? (
							<Skeleton
								className={`${typeStyles.railValue} ${styles.rowSkeleton}`}
							/>
						) : (
							<span
								className={`${typeStyles.railValue} ${
									row.value === null ? styles.placeholder : styles.rowValue
								}`}
							>
								{row.value ?? "Unavailable"}
							</span>
						)}
					</li>
				))}
			</ul>
		</div>
		{groups.map((group) => (
			<div className={styles.group} key={group.title}>
				<span className={`${typeStyles.label} ${styles.groupTitle}`}>
					{group.title}
				</span>
				<ul className={styles.rows}>
					{group.rows.map((row) => {
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
									<span
										className={`${typeStyles.railValue} ${styles.placeholder}`}
									>
										Unavailable
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

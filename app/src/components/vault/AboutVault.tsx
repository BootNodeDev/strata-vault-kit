import React from "react"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import styles from "./AboutVault.module.css"
import AddressRows, { type AddressRow } from "./AddressRows"

export type { AddressRow }

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
				<AddressRows rows={group.rows} />
			</div>
		))}
	</section>
)

export default AboutVault

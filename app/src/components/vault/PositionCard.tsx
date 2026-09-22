import React from "react"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import styles from "./PositionCard.module.css"

export type PositionCardProps = {
	heading: string
	label: string
	value: string | null
	sub: string
	note?: string
	pending?: boolean
}

const PositionCard: React.FC<PositionCardProps> = ({
	heading,
	label,
	value,
	sub,
	note,
	pending,
}) => (
	<div className={styles.card}>
		<h2 className={`${typeStyles.sectionHead} ${styles.heading}`}>{heading}</h2>
		<span className={`${typeStyles.label} ${styles.label}`}>{label}</span>
		<div className={styles.figure}>
			{pending ? (
				<Skeleton
					className={`${typeStyles.position} ${styles.valueSkeleton}`}
				/>
			) : (
				<span className={`${typeStyles.position} ${styles.value}`}>
					{value ?? "—"}
				</span>
			)}
			<span className={`${typeStyles.railValue} ${styles.sub}`}>{sub}</span>
		</div>
		{note && <p className={`${typeStyles.footnote} ${styles.note}`}>{note}</p>}
	</div>
)

export default PositionCard

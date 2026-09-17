import React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./PositionCard.module.css"

export type PositionCardProps = {
	label: string
	value: string | null
	sub: string
	note?: string
}

const PositionCard: React.FC<PositionCardProps> = ({
	label,
	value,
	sub,
	note,
}) => (
	<div className={styles.card}>
		<span className={`${typeStyles.label} ${styles.label}`}>{label}</span>
		<div className={styles.figure}>
			<span className={`${typeStyles.position} ${styles.value}`}>
				{value ?? "—"}
			</span>
			<span className={`${typeStyles.railValue} ${styles.sub}`}>{sub}</span>
		</div>
		{note && <p className={`${typeStyles.footnote} ${styles.note}`}>{note}</p>}
	</div>
)

export default PositionCard

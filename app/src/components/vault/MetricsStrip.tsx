import React from "react"
import typeStyles from "../../styles/type.module.css"
import Skeleton from "../Skeleton"
import styles from "./MetricsStrip.module.css"

export type Metric = {
	label: string
	value: string | null
	note: string
	pending?: boolean
}

type MetricsStripProps = {
	metrics: [Metric, Metric, Metric, Metric]
}

const MetricsStrip: React.FC<MetricsStripProps> = ({ metrics }) => (
	<div className={styles.strip}>
		{metrics.map((metric) => (
			<div className={styles.cell} key={metric.label}>
				<span className={`${typeStyles.label} ${styles.label}`}>
					{metric.label}
				</span>
				{metric.pending ? (
					<Skeleton
						className={`${typeStyles.metric} ${styles.valueSkeleton}`}
					/>
				) : (
					<span className={`${typeStyles.metric} ${styles.value}`}>
						{metric.value ?? "—"}
					</span>
				)}
				<span className={`${typeStyles.metricSub} ${styles.note}`}>
					{metric.note}
				</span>
			</div>
		))}
	</div>
)

export default MetricsStrip

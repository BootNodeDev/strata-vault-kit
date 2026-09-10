import React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./LifecyclePanel.module.css"

export type LifecycleStep = {
	title: string
	actor: string
	body: string
}

type LifecyclePanelProps = {
	title: string
	progress: string
	steps: [LifecycleStep, LifecycleStep, LifecycleStep]
	currentStep: 1 | 2 | 3 | null
}

type StepState = "done" | "current" | "upcoming"

const stepState = (
	position: number,
	currentStep: 1 | 2 | 3 | null,
): StepState => {
	if (currentStep === null) return "upcoming"
	if (position < currentStep) return "done"
	if (position === currentStep) return "current"
	return "upcoming"
}

const LifecyclePanel: React.FC<LifecyclePanelProps> = ({
	title,
	progress,
	steps,
	currentStep,
}) => (
	<div className={styles.panel}>
		<div className={styles.header}>
			<h3 className={`${typeStyles.sectionHead} ${styles.title}`}>{title}</h3>
			<span className={`${typeStyles.metricSub} ${styles.progress}`}>
				{progress}
			</span>
		</div>
		<ol role="list" className={styles.steps}>
			{steps.map((step, index) => {
				const position = index + 1
				const state = stepState(position, currentStep)
				const showConnector = index < 2

				return (
					<li
						className={styles.step}
						key={step.title}
						aria-current={state === "current" ? "step" : undefined}
					>
						<div className={styles.markerRow}>
							<span className={`${styles.marker} ${styles[state]}`}>
								{position}
							</span>
							{showConnector && (
								<span
									aria-hidden="true"
									className={`${styles.connector} ${
										state === "done" ? styles.connectorDone : ""
									}`}
								/>
							)}
						</div>
						<span
							className={`${typeStyles.stepTitle} ${
								state === "upcoming" ? styles.titleMuted : styles.titleActive
							}`}
						>
							{step.title}
						</span>
						<span className={styles.actor}>{step.actor}</span>
						<p
							className={`${typeStyles.footnote} ${
								state === "current" ? styles.bodyCurrent : styles.bodyMuted
							}`}
						>
							{step.body}
						</p>
					</li>
				)
			})}
		</ol>
	</div>
)

export default LifecyclePanel

import React from "react"
import styles from "./Skeleton.module.css"

const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
	<span
		role="progressbar"
		aria-label="Loading"
		className={`${styles.skeleton} ${className ?? ""}`}
	/>
)

export default Skeleton

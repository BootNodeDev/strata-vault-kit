import React from "react"
import styles from "./SurfaceLayout.module.css"

const SurfaceLayout: React.FC<{
	side: React.ReactNode
	children: React.ReactNode
}> = ({ side, children }) => (
	<div className={styles.layout}>
		<div className={styles.body}>
			<aside className={styles.side} aria-label="Actions">
				{side}
			</aside>
			<div className={styles.main}>{children}</div>
		</div>
	</div>
)

export default SurfaceLayout

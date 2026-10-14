import type React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./Disclosure.module.css"

const Disclosure: React.FC<{
	title: string
	children: React.ReactNode
}> = ({ title, children }) => (
	<details className={styles.disclosure}>
		<summary className={`${typeStyles.footnote} ${styles.title}`}>
			{title}
		</summary>
		<div className={styles.body}>{children}</div>
	</details>
)

export default Disclosure

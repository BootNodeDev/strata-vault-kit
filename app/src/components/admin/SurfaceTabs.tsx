import React from "react"
import { NavLink } from "react-router-dom"
import {
	type AdminSurface,
	SURFACE_LABELS,
} from "../../hooks/useAdminAuthority"
import typeStyles from "../../styles/type.module.css"
import styles from "./SurfaceTabs.module.css"

const SurfaceTabs: React.FC<{ surfaces: AdminSurface[] }> = ({ surfaces }) => (
	<nav aria-label="Admin surfaces" className={styles.tabs}>
		{surfaces.map((surface) => (
			<NavLink
				key={surface}
				to={`/admin/${surface}`}
				className={({ isActive }) =>
					`${typeStyles.body} ${styles.tab} ${isActive ? styles.active : ""}`
				}
			>
				{SURFACE_LABELS[surface]}
			</NavLink>
		))}
	</nav>
)

export default SurfaceTabs

import { Outlet, Route, Routes } from "react-router-dom"
import styles from "./App.module.css"
import ConnectAccount from "./components/ConnectAccount"
import ExternalLink from "./components/icons/ExternalLink"
import VaultPreview from "./pages/VaultPreview"

function App() {
	return (
		<Routes>
			<Route element={<AppLayout />}>
				<Route path="/" element={<VaultPreview />} />
			</Route>
		</Routes>
	)
}

const AppLayout = () => (
	<div className={styles.AppLayout}>
		<header className={styles.header}>
			<span className={styles.logo}>Strata Vault Kit</span>
			<ConnectAccount />
		</header>

		<main className={styles.main}>
			<Outlet />
		</main>

		<footer className={styles.footer}>
			<nav className={styles.footerNav}>
				<a
					href="https://github.com/BootNodeDev/strata-vault-kit"
					target="_blank"
					rel="noreferrer"
				>
					GitHub
					<ExternalLink className={styles.linkIcon} />
				</a>
			</nav>
		</footer>
	</div>
)

export default App

import { labPrefix } from "@stellar-scaffold/app-lib"
import React from "react"
import { Link } from "react-router-dom"
import styles from "./Home.module.css"

const Home: React.FC = () => (
	<div className={styles.Home}>
		<div>
			<h1>Strata Vault Kit</h1>
			<p>
				A white-label tokenized vault template for Stellar. Operators fork this
				repository, re-skin the interface, and deploy a vault under their own
				brand. Deposits mint vault shares 1:1, and the shares carry no yield.
			</p>
		</div>

		<div className="card">
			<h2>Before you connect a wallet</h2>
			<ul>
				<li>
					This build targets Stellar testnet. Do not point it at mainnet, or at
					funds you cannot afford to lose.
				</li>
				<li>The contracts are not audited.</li>
				<li>
					This page is a placeholder. The investor interface is not built yet.
				</li>
			</ul>
		</div>

		<section className={styles.cards}>
			<div className="card">
				<p>
					Call the vault contract directly from the{" "}
					<Link to="/debug">Contract Explorer</Link>
				</p>
			</div>
			<div className="card">
				<p>
					Inspect the transactions you submit with the{" "}
					<Link to={labPrefix()}>Transaction Explorer</Link>
				</p>
			</div>
		</section>
	</div>
)

export default Home

export default function Debug() {
	return (
		<div className="debug">
			<h2>Contract Explorer</h2>
			<p>
				This build does not ship an in-app contract explorer. The route is kept
				so the header link has somewhere to land once one exists.
			</p>
			<p>
				In the meantime, use the{" "}
				<a href="https://lab.stellar.org" target="_blank" rel="noreferrer">
					Stellar Lab
				</a>{" "}
				to invoke contract methods and inspect the transactions you submit.
			</p>
		</div>
	)
}

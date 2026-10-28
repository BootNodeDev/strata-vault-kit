import { describeTarget, resolveTarget } from "./lib/extend-target.js"
import { keepDeploymentAlive } from "./lib/keep-alive.js"
import { latestLedger } from "./lib/ttl.js"

// Restores, when archived, and extends by 30 days each contract instance, the
// Wasm it runs and each pending timelock change, so an idle deployment stays
// callable. Extending needs no authority: any funded account pays.

async function main(): Promise<void> {
	if (!process.env["STELLAR_ACCOUNT"])
		throw new Error(
			"set STELLAR_ACCOUNT to a funded account: a stellar CLI identity name or a secret key",
		)
	const target = resolveTarget(process.argv.slice(2), process.env)
	console.log(describeTarget(target))
	const latest = await latestLedger(target.rpc)
	console.log(
		`extending ${target.contracts.length} contracts, latest ledger ${latest}`,
	)
	await keepDeploymentAlive(target.rpc, target.contracts)
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})

import { execSync } from "node:child_process"

// Runs as the root `prestart` hook. `start` runs `stellar scaffold watch`, so
// the CLIs it shells out to must be present, or the failure surfaces as an
// unrelated error deep in the watch output.
const TOOLS = [
	{
		name: "Stellar CLI",
		check: "stellar --version",
		install: "cargo install --locked stellar-cli",
		binstall: "cargo binstall -y --locked stellar-cli",
		url: "https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli",
	},
	{
		name: "Stellar Scaffold CLI",
		check: "stellar scaffold --version",
		install: "cargo install --locked stellar-scaffold-cli",
		binstall: "cargo binstall -y --locked stellar-scaffold-cli",
		url: "https://github.com/stellar-scaffold/cli#quickstart-new-developers-welcome",
	},
]

function has(cmd) {
	try {
		execSync(cmd, { stdio: "ignore" })
		return true
	} catch {
		return false
	}
}

const missing = TOOLS.filter((t) => !has(t.check))
if (missing.length > 0) {
	const installer = has("cargo binstall --version") ? "binstall" : "install"
	console.error(
		[
			"",
			"Cannot start — install the required Stellar tools first:",
			"",
			...missing.flatMap((t) => [
				`  - ${t.name}`,
				`      ${t[installer]}`,
				`      docs: ${t.url}`,
			]),
			"",
		].join("\n"),
	)
	process.exit(1)
}

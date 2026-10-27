// Reads one environment's network and contract ids from environments.toml;
// a local environment declares none, so its ids come from the CLI's aliases.
import { execFileSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export const selectedEnvironment = (env) => env.ADDRESSES_ENV ?? "staging"

const section = (toml, header) => {
	const body = toml.split(`[${header}]`)[1]?.split("\n[")[0]
	if (body === undefined) {
		throw new Error(
			`environments.toml has no [${header}] section. ` +
				`Set ADDRESSES_ENV to an environment it declares.`,
		)
	}
	return body
}

const value = (body, key, environment) => {
	const found = body.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1]
	if (found === undefined) {
		throw new Error(`[${environment}.network] declares no ${key}.`)
	}
	return found
}

export const networkOf = (toml, environment) => {
	const body = section(toml, `${environment}.network`)
	const rpcUrl = value(body, "rpc-url", environment)
	return {
		rpcUrl,
		networkPassphrase: value(body, "network-passphrase", environment),
		allowHttp: rpcUrl.startsWith("http://"),
	}
}

const cliAlias = (alias, { rpcUrl, networkPassphrase }) => {
	const args = ["contract", "alias", "show", alias]
	args.push("--rpc-url", rpcUrl, "--network-passphrase", networkPassphrase)
	try {
		return execFileSync("stellar", args, {
			cwd: repoRoot,
			stdio: "pipe",
			encoding: "utf8",
		}).trim()
	} catch (error) {
		if (error.code === "ENOENT") {
			throw new Error("stellar CLI not found on PATH")
		}
		throw new Error(error.stderr?.trim().split("\n").at(-1) ?? error.message)
	}
}

// The console also needs the vault's asset, a SAC with no block of its own.
const deployedAliases = (toml, environment) => {
	const headers = new RegExp(`^\\[${environment}\\.contracts\\.(\\w+)\\]`, "gm")
	const names = [...toml.matchAll(headers)].map(([, name]) => name)
	return names.length === 0 ? [] : [...names, "asset"]
}

export const contractIds = (toml, environment, resolveAlias = cliAlias) => {
	const body = section(toml, `${environment}.contracts`)
	const declared = [
		...body.matchAll(/^(\w+)\s*=\s*\{[^}]*id\s*=\s*"(C\w+)"/gm),
	].map(([, name, id]) => ({ name, id }))
	if (declared.length > 0) {
		return declared
	}
	const deployed = deployedAliases(toml, environment)
	if (deployed.length === 0) {
		throw new Error(
			`[${environment}.contracts] declares no deployed addresses. ` +
				`Deploy first, or set ADDRESSES_ENV to an environment that has them.`,
		)
	}
	const network = networkOf(toml, environment)
	return deployed.map((name) => {
		try {
			return { name, id: resolveAlias(name, network) }
		} catch (error) {
			throw new Error(
				`Cannot resolve contract alias '${name}' for [${environment}.contracts]: ` +
					`${error.message}. Register it first: the scaffold build deploys ` +
					`the contract blocks, and \`stellar contract asset deploy --asset ` +
					`native --alias asset\` deploys the asset.`,
			)
		}
	})
}

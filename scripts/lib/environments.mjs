// Reads one environment's network and deployed contract ids from environments.toml.

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

export const contractIds = (toml, environment) => {
	const body = section(toml, `${environment}.contracts`)
	const ids = [...body.matchAll(/^(\w+)\s*=\s*\{[^}]*id\s*=\s*"(C\w+)"/gm)].map(
		([, name, id]) => ({ name, id }),
	)
	if (ids.length === 0) {
		throw new Error(
			`[${environment}.contracts] declares no deployed addresses. ` +
				`Deploy first, or set ADDRESSES_ENV to an environment that has them.`,
		)
	}
	return ids
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

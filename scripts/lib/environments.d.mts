type Network = { rpcUrl: string; networkPassphrase: string; allowHttp: boolean }

export function selectedEnvironment(
	env: Record<string, string | undefined>,
): string

export function contractIds(
	toml: string,
	environment: string,
	resolveAlias?: (alias: string, network: Network) => string,
): Array<{ name: string; id: string }>

export function networkOf(toml: string, environment: string): Network

export function selectedEnvironment(
	env: Record<string, string | undefined>,
): string

export function contractIds(
	toml: string,
	environment: string,
): Array<{ name: string; id: string }>

export function networkOf(
	toml: string,
	environment: string,
): { rpcUrl: string; networkPassphrase: string; allowHttp: boolean }

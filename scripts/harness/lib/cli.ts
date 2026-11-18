import { execFile } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, join } from "node:path"
import { promisify } from "node:util"

import {
	BindingGenerator,
	Contract,
	StrKey,
	type Asset,
	type Keypair,
	type rpc,
} from "@stellar/stellar-sdk"

import { writeClient } from "../../lib/clients.mjs"
import { REPO_ROOT } from "./deployment.js"
import { type Network } from "./network.js"

const run = promisify(execFile)
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc")
const execOptions = { maxBuffer: 16 * 1024 * 1024 }

async function exec(
	command: string,
	args: readonly string[],
	options: Record<string, unknown> = {},
): Promise<string> {
	try {
		const { stdout } = await run(command, [...args], {
			...execOptions,
			...options,
		})
		return stdout.trim()
	} catch (error) {
		const { code, stdout, stderr } = error as {
			code?: number
			stdout?: string
			stderr?: string
		}
		const exitCode = code === undefined ? "" : ` (exit ${code})`
		throw new Error(
			`${basename(command)} failed${exitCode}:\n${stdout ?? ""}${stderr ?? ""}`,
		)
	}
}

export async function stellar(
	args: readonly string[],
	options: Record<string, unknown> = {},
): Promise<string> {
	return exec("stellar", args, options)
}

/** The two settings every network command needs. */
export type Rpc = Pick<Network, "rpcUrl" | "passphrase">

export function rpcArgs(net: Rpc): string[] {
	return ["--rpc-url", net.rpcUrl, "--network-passphrase", net.passphrase]
}

function withSource(source: Keypair): { env: NodeJS.ProcessEnv } {
	return { env: { ...process.env, STELLAR_ACCOUNT: source.secret() } }
}

function lastContractId(output: string): string {
	const id = output
		.split("\n")
		.map((line) => line.trim())
		.findLast((line) => StrKey.isValidContract(line))
	if (id === undefined)
		throw new Error(`no contract id in CLI output:\n${output}`)
	return id
}

export type ConstructorArgs =
	readonly string[] | Record<string, string | number | boolean>

function formatArgs(args: ConstructorArgs): string[] {
	if (Array.isArray(args)) return [...args]
	return Object.entries(args).flatMap(([k, v]) => [`--${k}`, String(v)])
}

// No "--" separator for a constructor that takes no arguments: the CLI
// refuses an empty one.
export function deployArgs(
	wasm: string,
	net: Rpc,
	constructorArgs: ConstructorArgs,
): string[] {
	const formatted = formatArgs(constructorArgs)
	return [
		"contract",
		"deploy",
		"--wasm",
		wasm,
		...rpcArgs(net),
		...(formatted.length > 0 ? ["--", ...formatted] : []),
	]
}

export async function deployContract(
	net: Network,
	wasm: string,
	source: Keypair,
	constructorArgs: ConstructorArgs,
): Promise<string> {
	const out = await stellar(
		deployArgs(wasm, net, constructorArgs),
		withSource(source),
	)
	return lastContractId(out)
}

async function deployAssetContract(
	net: Network,
	asset: Asset,
	source: Keypair,
): Promise<string> {
	const out = await stellar(
		[
			"contract",
			"asset",
			"deploy",
			"--asset",
			`${asset.getCode()}:${asset.getIssuer()}`,
			...rpcArgs(net),
		],
		withSource(source),
	)
	return lastContractId(out)
}

// The asset contract's id follows from the asset, so a kept issuer may have one.
export async function ensureAssetContract(
	net: Network,
	server: rpc.Server,
	asset: Asset,
	source: Keypair,
): Promise<string> {
	const id = asset.contractId(net.passphrase)
	const { entries } = await server.getLedgerEntries(
		new Contract(id).getFootprint(),
	)
	if (entries.length > 0) return id
	return deployAssetContract(net, asset, source)
}

export type ClientPackageJson = Record<string, unknown> & {
	dependencies?: Record<string, string>
}

/** Pins a generated client's stellar-sdk dependency, leaving other packages untouched. */
export function pinClientSdk<T extends ClientPackageJson>(
	pkg: T,
	version: string,
): T {
	if (pkg.dependencies?.["@stellar/stellar-sdk"] === undefined) return pkg
	return {
		...pkg,
		dependencies: { ...pkg.dependencies, "@stellar/stellar-sdk": version },
	}
}

export function rootSdkVersion(): string {
	const rootPkg = JSON.parse(
		readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
	) as { overrides?: Record<string, string> }
	const version = rootPkg.overrides?.["@stellar/stellar-sdk"]
	if (version === undefined) {
		throw new Error(
			'root package.json is missing overrides["@stellar/stellar-sdk"]',
		)
	}
	return version
}

export const wasmGenerator = (wasm: string): BindingGenerator =>
	BindingGenerator.fromWasm(readFileSync(wasm))

/** Writes a client's SDK bindings to `outDir`, named after it, with its stellar-sdk pinned. */
export function writeClientSources(
	outDir: string,
	generator: BindingGenerator,
	sdkVersion: string,
): void {
	writeClient(outDir, generator.generate({ contractName: basename(outDir) }))
	const pkgPath = join(outDir, "package.json")
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as ClientPackageJson
	const pinned = pinClientSdk(pkg, sdkVersion)
	if (pinned !== pkg) {
		writeFileSync(pkgPath, JSON.stringify(pinned, null, 2) + "\n")
	}
}

/** Writes a client's sources and compiles its `dist/`, which the harness imports. */
export async function generateClient(
	outDir: string,
	generator: BindingGenerator,
	sdkVersion: string,
): Promise<void> {
	writeClientSources(outDir, generator, sdkVersion)
	// TypeScript 6 needs the rootDir and the node types the generated tsconfig leaves to defaults.
	await exec(process.execPath, [
		tsc,
		"-p",
		outDir,
		"--rootDir",
		join(outDir, "src"),
		"--types",
		"node",
	])
}

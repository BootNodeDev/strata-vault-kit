import { execFile } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, join } from "node:path"
import { promisify } from "node:util"

import { StrKey, type Asset, type Keypair } from "@stellar/stellar-sdk"

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

async function stellar(
	args: readonly string[],
	options: Record<string, unknown> = {},
): Promise<string> {
	return exec("stellar", args, options)
}

function rpcArgs(net: Network): string[] {
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

export async function deployContract(
	net: Network,
	wasm: string,
	source: Keypair,
	constructorArgs: ConstructorArgs,
): Promise<string> {
	const out = await stellar(
		[
			"contract",
			"deploy",
			"--wasm",
			wasm,
			...rpcArgs(net),
			"--",
			...formatArgs(constructorArgs),
		],
		withSource(source),
	)
	return lastContractId(out)
}

export async function deployAssetContract(
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

export async function generateClient(
	wasm: string,
	outDir: string,
): Promise<void> {
	await stellar([
		"contract",
		"bindings",
		"typescript",
		"--wasm",
		wasm,
		"--output-dir",
		outDir,
		"--overwrite",
	])
	const pkgPath = join(outDir, "package.json")
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			dependencies?: Record<string, string>
		}
		if (pkg.dependencies?.["@stellar/stellar-sdk"]) {
			pkg.dependencies["@stellar/stellar-sdk"] = "16.1.0"
			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
		}
	}
	// TypeScript 6 rejects the CLI-generated tsconfig without an explicit rootDir.
	await exec(process.execPath, [
		tsc,
		"-p",
		outDir,
		"--rootDir",
		join(outDir, "src"),
	])
}

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { parseOperatorValues, type OperatorValues } from "./stellar-toml.js"

export function readOperatorValues(
	env: Record<string, string | undefined>,
	readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): OperatorValues {
	const configured = env["SEP1_OPERATOR"]
	if (configured === undefined) return {}

	// npm runs workspace scripts from the workspace; resolve from where it was called.
	const path = resolve(env["INIT_CWD"] ?? process.cwd(), configured)
	let parsed: unknown
	try {
		parsed = JSON.parse(readFile(path))
	} catch (cause) {
		throw new Error(`${configured} is not valid JSON (${String(cause)})`)
	}
	return parseOperatorValues(parsed)
}

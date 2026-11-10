import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { type ContractName } from "./deployment.js"

export function wasmHash(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex")
}

export function sourceCommit(dir: string): {
	commit: string
	uncommittedChanges: boolean
} {
	const git = (...args: string[]): string => {
		try {
			return execFileSync("git", ["-C", dir, ...args], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			})
		} catch (error) {
			// Default stdio forwards the child's stderr to ours; capture it instead.
			const stderr =
				error instanceof Error && "stderr" in error
					? String((error as { stderr?: unknown }).stderr).trim()
					: ""
			throw new Error(
				`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
			)
		}
	}

	const commit = git("rev-parse", "HEAD").trim()
	const status = git("status", "--porcelain", "--untracked-files=no")
	return { commit, uncommittedChanges: status.trim() !== "" }
}

export interface Provenance {
	commit: string
	uncommittedChanges: boolean
	wasmHashes: Record<ContractName, string>
}

// Reads the checkout and the wasm files, nothing else; safe to call before
// any network action, so a deploy outside a checkout fails before it starts.
export function readProvenance(
	dir: string,
	wasms: Record<ContractName, string>,
): Provenance {
	const { commit, uncommittedChanges } = sourceCommit(dir)
	const wasmHashes = Object.fromEntries(
		Object.entries(wasms).map(([name, file]) => [name, wasmHash(file)]),
	) as Record<ContractName, string>
	return { commit, uncommittedChanges, wasmHashes }
}

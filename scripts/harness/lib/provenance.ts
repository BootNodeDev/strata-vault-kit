import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export function wasmHash(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex")
}

export function sourceCommit(dir: string): {
	commit: string
	uncommittedChanges: boolean
} {
	const git = (...args: string[]): string =>
		execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" })

	const commit = git("rev-parse", "HEAD").trim()
	const status = git("status", "--porcelain", "--untracked-files=no")
	return { commit, uncommittedChanges: status.trim() !== "" }
}

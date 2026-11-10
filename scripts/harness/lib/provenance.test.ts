import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CONTRACT_NAMES, type ContractName } from "./deployment.js"
import { readProvenance, sourceCommit, wasmHash } from "./provenance.js"

let dir = ""

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "harness-provenance-"))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

function git(...args: string[]): string {
	// Isolate from the machine's global hooks (e.g. gitleaks on commit).
	return execFileSync(
		"git",
		["-C", dir, "-c", "core.hooksPath=/dev/null", ...args],
		{ encoding: "utf8" },
	)
}

function commitFile(name: string, content: string): void {
	writeFileSync(join(dir, name), content)
	git("add", name)
	git(
		"-c",
		"user.email=t@t",
		"-c",
		"user.name=t",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-q",
		"-m",
		"msg",
	)
}

describe("wasmHash", () => {
	it("hashes a Wasm file with SHA-256", () => {
		const file = join(dir, "contract.wasm")
		writeFileSync(file, "abc")

		expect(wasmHash(file)).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		)
	})
})

describe("sourceCommit", () => {
	it("names the checked-out commit", () => {
		git("init", "-q")
		commitFile("a.txt", "one")

		const result = sourceCommit(dir)

		expect(result.commit).toBe(git("rev-parse", "HEAD").trim())
		expect(result.uncommittedChanges).toBe(false)
	})

	it("flags an edit to a tracked file", () => {
		git("init", "-q")
		commitFile("a.txt", "one")
		writeFileSync(join(dir, "a.txt"), "two")

		expect(sourceCommit(dir).uncommittedChanges).toBe(true)
	})

	it("ignores untracked files", () => {
		git("init", "-q")
		commitFile("a.txt", "one")
		writeFileSync(join(dir, "b.txt"), "new")

		expect(sourceCommit(dir).uncommittedChanges).toBe(false)
	})

	it("stops outside a git checkout", () => {
		expect(() => sourceCommit(dir)).toThrow(/git/)
	})
})

const wasmsOf = (file: string): Record<ContractName, string> =>
	Object.fromEntries(CONTRACT_NAMES.map((name) => [name, file])) as Record<
		ContractName,
		string
	>

describe("readProvenance", () => {
	it("combines the commit and every wasm's hash", () => {
		git("init", "-q")
		commitFile("a.txt", "one")
		const file = join(dir, "contract.wasm")
		writeFileSync(file, "abc")

		const result = readProvenance(dir, wasmsOf(file))

		expect(result.commit).toBe(git("rev-parse", "HEAD").trim())
		expect(result.uncommittedChanges).toBe(false)
		for (const name of CONTRACT_NAMES) {
			expect(result.wasmHashes[name]).toBe(wasmHash(file))
		}
	})

	it("stops outside a git checkout before hashing any wasm", () => {
		const missing = join(dir, "missing.wasm")

		expect(() => readProvenance(dir, wasmsOf(missing))).toThrow(/git/)
	})
})

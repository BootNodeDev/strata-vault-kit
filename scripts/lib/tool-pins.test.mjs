import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const read = (path) => readFileSync(resolve(root, path), "utf8")

const occurrences = (text, substring) => text.split(substring).length - 1

const pins = Object.fromEntries(
	[
		...read("scripts/ci/install-tools.sh").matchAll(/^([A-Z0-9_]+)=(\S+)$/gm),
	].map(([, name, value]) => [name, value]),
)

describe("the installer's pins", () => {
	it("CI installs its tools through the checked installer", () => {
		const workflow = read(".github/workflows/build.yml")

		expect(workflow).not.toMatch(/binstall/)
		expect(workflow).toContain(
			"scripts/ci/install-tools.sh stellar stellar-scaffold",
		)
		expect(workflow).toContain("scripts/ci/install-tools.sh gitleaks")
	})

	it("the README runs the quickstart image CI runs", () => {
		const image = read(".github/workflows/build.yml").match(
			/IMAGE:\s*(\S+)/,
		)?.[1]

		expect(image).toMatch(/@sha256:[0-9a-f]{64}$/)
		expect(read("README.md")).toContain(image)
	})

	it("the README installs the stellar CLI version CI installs", () => {
		const readme = read("README.md")

		expect(readme).toContain(`stellar-cli@${pins.STELLAR_CLI_VERSION}`)
		expect(readme).not.toMatch(/brew install/)
	})

	it("the dev guard suggests the CLI versions CI installs", () => {
		const devGuard = read("scripts/dev-guard.mjs")

		expect(
			occurrences(devGuard, `stellar-cli@${pins.STELLAR_CLI_VERSION}"`),
		).toBe(2)
		expect(
			occurrences(
				devGuard,
				`stellar-scaffold-cli@${pins.STELLAR_SCAFFOLD_VERSION}"`,
			),
		).toBe(2)
	})

	it("the commit hook runs the gitleaks version CI runs", () => {
		const rev = read(".pre-commit-config.yaml").match(
			/repo: https:\/\/github\.com\/gitleaks\/gitleaks\s+rev: (\S+)/,
		)?.[1]

		expect(rev).toBe(`v${pins.GITLEAKS_VERSION}`)
	})

	it("the devshell's stellar CLI is the tarball CI checks", () => {
		const flake = read("flake.nix")

		expect(flake).toContain(`cliVersion = "${pins.STELLAR_CLI_VERSION}"`)

		const hash = flake.match(
			/x86_64-linux = \{\s*target = "x86_64-unknown-linux-gnu";\s*hash = "sha256-([^"]+)"/,
		)?.[1]

		expect(Buffer.from(hash ?? "", "base64").toString("hex")).toBe(
			pins.STELLAR_CLI_SHA256,
		)
	})

	it("the root package pins its tools and overrides exactly", () => {
		const pkg = JSON.parse(read("package.json"))
		const versions = [
			...Object.values(pkg.devDependencies),
			...Object.values(pkg.overrides),
		]

		for (const version of versions) {
			expect(version).toMatch(/^\d+\.\d+\.\d+$/)
		}
	})
})

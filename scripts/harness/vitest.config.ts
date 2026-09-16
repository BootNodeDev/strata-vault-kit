import { defineConfig } from "vitest/config"

const network = process.env["HARNESS_NETWORK"] ?? "local"

export default defineConfig({
	test: {
		include: ["*.test.ts"],
		environment: "node",
		fileParallelism: false,
		sequence: { concurrent: false },
		bail: 1,
		testTimeout: 240_000,
		hookTimeout: 300_000,
		reporters: ["default", ["json", { outputFile: `runs/${network}.json` }]],
	},
})

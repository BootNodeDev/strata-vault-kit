import { defineConfig, devices } from "@playwright/test"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = 5180

export default defineConfig({
	testDir: "./tests",
	reporter: "list",
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	projects: [
		{
			name: "app",
			use: {
				...devices["Desktop Chrome"],
				baseURL: `http://localhost:${PORT}`,
			},
		},
	],
	webServer: [
		{
			// Only the dev server. `npm start` would also spawn the contract-watch
			// process, which needs Docker and the network.
			command: `npx vite --port ${PORT} --strictPort`,
			cwd: resolve(repoRoot, "app"),
			url: `http://localhost:${PORT}`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
	],
})

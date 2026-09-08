import { resolve } from "node:path"
import { configDefaults, defineConfig } from "vitest/config"

const setupFiles = [resolve(import.meta.dirname, "vitest.setup.ts")]

export default defineConfig({
	test: {
		projects: [
			{
				root: "./app",
				test: {
					name: "app",
					environment: "jsdom",
					setupFiles,
					include: ["src/**/*.test.{ts,tsx}"],
					// CJS without an `exports` field: Node's ESM loader cannot see its
					// named exports. Remove once the package ships ESM.
					server: { deps: { inline: [/@creit\.tech\/stellar-wallets-kit/] } },
				},
			},
			{
				root: "./app-lib",
				test: {
					name: "app-lib",
					environment: "node",
					include: ["**/*.test.ts"],
					// `clients/` is generated and does not exist yet.
					exclude: [...configDefaults.exclude, "clients/**"],
				},
			},
		],
	},
	// No @vitejs/plugin-react: the JSX transform comes from app/tsconfig.app.json.
})

import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import wasm from "vite-plugin-wasm"
import { parseNetworkEnv } from "../app-lib/networkEnv"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	parseNetworkEnv(loadEnv(mode, import.meta.dirname, "PUBLIC_"))
	return {
		plugins: [
			react(),
			nodePolyfills({
				include: ["buffer"],
				globals: {
					Buffer: true,
				},
			}),
			wasm(),
		],
		resolve: {
			dedupe: ["@stellar/stellar-sdk"],
		},
		build: {
			target: "esnext",
		},
		optimizeDeps: {
			exclude: ["@stellar/stellar-xdr-json"],
		},
		define: {
			global: "window",
		},
		envPrefix: "PUBLIC_",
		server: {
			proxy: {
				"/friendbot": {
					target: "http://localhost:8000/friendbot",
					changeOrigin: true,
				},
			},
		},
	}
})

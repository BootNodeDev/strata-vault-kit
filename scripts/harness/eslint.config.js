import { config } from "@theahaco/ts-config/eslint"
import globals from "globals"

/** @type {import("eslint").Linter.Config[]} */
export default [
	...config,
	{
		files: ["**/*.ts"],
		languageOptions: {
			globals: globals.node,
			parserOptions: { tsconfigRoot: import.meta.dirname },
		},
	},
	{
		files: ["**/*.ts"],
		ignores: ["**/*.test.ts", "vitest.config.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "vitest",
							message:
								"Only tests import vitest: scripts such as seed.ts run without it.",
						},
					],
				},
			],
		},
	},
]

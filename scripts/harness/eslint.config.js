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
]

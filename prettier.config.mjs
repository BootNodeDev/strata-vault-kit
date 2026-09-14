import shared from "@theahaco/ts-config/prettier"

export default {
	...shared,
	overrides: [
		...(shared.overrides ?? []),
		// Prose is written unwrapped; prettier still tidies lists, tables and fences.
		{ files: "**/*.md", options: { proseWrap: "preserve" } },
	],
}

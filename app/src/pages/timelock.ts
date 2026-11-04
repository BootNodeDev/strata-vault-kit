import { type Condition } from "./actions"
import { formatDuration } from "./cycle"

export type Route = "direct" | "timelock" | null

const SETUP_OPEN = "Setup is open"

export const routeCondition = (
	route: Route,
	delay: bigint | null,
	atOnce = SETUP_OPEN,
): Condition => {
	if (route === null) return { label: "Setup state read", met: null }
	if (route === "direct")
		return { label: "Applies at once", met: true, detail: atOnce }
	return {
		label: "Waits for the timelock",
		met: true,
		detail: delay === null ? "Upgrade delay" : formatDuration(delay),
	}
}

export const routeOf = (
	setupOpen: boolean | null,
	waits: boolean | undefined,
): Route => {
	if (setupOpen === null) return null
	if (setupOpen) return "direct"
	if (waits === undefined) return null
	return waits ? "timelock" : "direct"
}

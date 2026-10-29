import { type Metric } from "../components/vault/MetricsStrip"
import { type Grant } from "../hooks/useAdminAuthority"
import { type OracleStatus } from "../hooks/useOracleState"
import { type SetupState } from "../hooks/useSetupOpen"
import { type PauseState } from "../hooks/useVaultPaused"
import {
	type Condition,
	grantFor,
	type RailAction,
	ROLES,
	type Spec,
	toAction,
} from "./actions"

export type EmergencyState = {
	vault: PauseState
	setup: SetupState
	token: PauseState
	oracle: OracleStatus
}

type PlainId =
	| "pause-vault"
	| "unpause-vault"
	| "unpause-nav"
	| "clear-latest"
	| "pause-token"
	| "unpause-token"

export type EmergencyAction = RailAction &
	({ id: PlainId } | { id: "pause-nav"; viaAdmin: boolean })

const PAUSE_LABELS = { open: "Open", paused: "Paused" } as const

const ORACLE_LABELS = {
	valid: "Valid",
	stale: "Stale",
	paused: "Paused",
} as const

const isKnown = (state: PauseState | OracleStatus): boolean =>
	state !== "checking" && state !== "unreadable"

const pauseIs = (
	label: string,
	state: PauseState,
	wanted: "open" | "paused",
): Condition => ({
	label,
	met: isKnown(state) ? state === wanted : null,
})

const navPaused = (oracle: OracleStatus): Condition => ({
	label: "NAV paused",
	met: isKnown(oracle) ? oracle === "paused" : null,
})

const vaultSpecs = (vault: PauseState): [Spec<PlainId>, Spec<PlainId>] => [
	{
		id: "pause-vault",
		label: "Pause the vault",
		conditions: [pauseIs("Vault is open", vault, "open")],
		outcome:
			"Stops new deposits, pricing and upgrades. Redemptions, claims, cancels and closing epochs stay open.",
		danger: true,
	},
	{
		id: "unpause-vault",
		label: "Unpause the vault",
		conditions: [pauseIs("Vault is paused", vault, "paused")],
		outcome:
			"Resumes deposits, pricing and upgrades. A pending upgrade waits longer by the time the vault spent paused.",
	},
]

const oracleAdminSpecs = (
	oracle: OracleStatus,
): [Spec<PlainId>, Spec<PlainId>] => [
	{
		id: "unpause-nav",
		label: "Unpause the NAV",
		conditions: [],
		outcome:
			"Resumes pricing: epochs can be fulfilled again while the price is valid.",
	},
	{
		id: "clear-latest",
		label: "Clear the latest price",
		conditions: [navPaused(oracle)],
		outcome:
			"Removes the recorded price, so the next attestation is not limited by its distance from the last. Pricing stays stopped until the NAV is unpaused.",
		danger: true,
	},
]

const tokenSpecs = (token: PauseState): [Spec<PlainId>, Spec<PlainId>] => [
	{
		id: "pause-token",
		label: "Pause the share token",
		conditions: [pauseIs("Share token is open", token, "open")],
		outcome:
			"Stops holder transfers only. Minting, burning, the vault's escrow moves and legal transfers continue.",
		danger: true,
	},
	{
		id: "unpause-token",
		label: "Unpause the share token",
		conditions: [pauseIs("Share token is paused", token, "paused")],
		outcome: "Resumes holder transfers.",
	},
]

const pauseGrant = (
	guardian: Grant | undefined,
	admin: Grant | undefined,
): Grant | undefined => {
	if (guardian?.standing === "signs-alone") return guardian
	if (admin?.standing === "signs-alone") return admin
	return guardian ?? admin
}

const pauseSpec = (oracle: OracleStatus): Spec<"pause-nav"> => ({
	id: "pause-nav",
	label: "Pause the NAV",
	conditions: [],
	outcome:
		"Stops pricing: no epoch can be fulfilled until it is unpaused. Attesting stays open.",
	...(oracle === "paused" ? { note: "NAV already paused." } : {}),
	danger: true,
})

export function toEmergencyActions(
	state: EmergencyState,
	grants: Grant[],
	wallet: string,
): EmergencyAction[] {
	if (grants.length === 0) return []
	const held = (role: string) => grantFor(grants, role, wallet)
	const [pauseVault, unpauseVault] = vaultSpecs(state.vault)
	const [unpause, clear] = oracleAdminSpecs(state.oracle)
	const [pauseToken, unpauseToken] = tokenSpecs(state.token)
	const oracleAdmin = held(ROLES.oracleAdmin)
	const tokenAdmin = held(ROLES.tokenAdmin)
	const pauser = pauseGrant(held(ROLES.oracleGuardian), oracleAdmin)

	const actions: EmergencyAction[] = []
	const guardian = held(ROLES.vaultGuardian)
	if (guardian !== undefined) actions.push(toAction(pauseVault, guardian))
	const governance = held(ROLES.governance)
	if (governance !== undefined) actions.push(toAction(unpauseVault, governance))
	if (pauser !== undefined)
		actions.push({
			...toAction(pauseSpec(state.oracle), pauser),
			viaAdmin: pauser.role === ROLES.oracleAdmin,
		})
	if (oracleAdmin !== undefined)
		actions.push(toAction(unpause, oracleAdmin), toAction(clear, oracleAdmin))
	if (tokenAdmin !== undefined)
		actions.push(
			toAction(pauseToken, tokenAdmin),
			toAction(unpauseToken, tokenAdmin),
		)
	return actions
}

const pauseTile = (label: string, state: PauseState): Metric => {
	if (state === "checking") return { label, value: null, pending: true }
	return { label, value: state === "unreadable" ? null : PAUSE_LABELS[state] }
}

const oracleTile = (oracle: OracleStatus): Metric => {
	const label = "Oracle"
	if (oracle === "checking") return { label, value: null, pending: true }
	if (oracle === "unreadable") return { label, value: null }
	return {
		label,
		value: ORACLE_LABELS[oracle],
		note: oracle === "paused" ? "NAV paused" : "NAV not paused",
	}
}

const SETUP_TILES: Record<"open" | "closed", Metric> = {
	open: {
		label: "Setup",
		value: "Open",
		note: "Changes apply at once; no deposits yet",
	},
	closed: {
		label: "Setup",
		value: "Closed",
		note: "Changes wait for the timelock",
	},
}

const setupTile = (setup: SetupState): Metric => {
	if (setup === "checking")
		return { label: "Setup", value: null, pending: true }
	if (setup === "unreadable") return { label: "Setup", value: null }
	return SETUP_TILES[setup]
}

export const toEmergencyTiles = (state: EmergencyState): Metric[] => [
	pauseTile("Vault", state.vault),
	setupTile(state.setup),
	pauseTile("Share token", state.token),
	oracleTile(state.oracle),
]

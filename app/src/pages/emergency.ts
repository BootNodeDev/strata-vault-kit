import { type Metric } from "../components/vault/MetricsStrip"
import { type Grant } from "../hooks/useAdminAuthority"
import { type OracleStatus } from "../hooks/useOracleState"
import { type PauseState } from "../hooks/useVaultPaused"
import {
	allMet,
	type Condition,
	grantFor,
	type RailAction,
	unavailableFor,
} from "./actions"

export type EmergencyState = {
	vault: PauseState
	token: PauseState
	oracle: OracleStatus
}

type SettledState = {
	vault: Exclude<PauseState, "checking">
	token: Exclude<PauseState, "checking">
	oracle: Exclude<OracleStatus, "checking">
}

type PlainId =
	| "pause-vault"
	| "unpause-vault"
	| "lower-ripcord"
	| "clear-latest"
	| "pause-token"
	| "unpause-token"

export type EmergencyAction = RailAction &
	({ id: PlainId } | { id: "raise-ripcord"; viaAdmin: boolean })

const ROLES = {
	vaultGuardian: "vault guardian",
	governance: "vault governance",
	oracleGuardian: "oracle guardian",
	oracleAdmin: "oracle admin",
	tokenAdmin: "share-token admin",
} as const

const PAUSE_LABELS = { open: "Open", paused: "Paused" } as const

const ORACLE_LABELS = {
	valid: "Valid",
	stale: "Stale",
	paused: "Paused",
} as const

const pauseIs = (
	label: string,
	state: SettledState["vault"],
	wanted: "open" | "paused",
): Condition => ({
	label,
	met: state === "unreadable" ? null : state === wanted,
})

const ripcordRaised = (oracle: SettledState["oracle"]): Condition => ({
	label: "Ripcord raised",
	met: oracle === "unreadable" ? null : oracle === "paused",
})

type Spec = {
	id: PlainId
	label: string
	conditions: Condition[]
	outcome: string
	danger?: boolean
}

const toAction = (
	spec: Spec,
	grant: Grant,
	wallet: string,
): EmergencyAction => {
	const unavailable = unavailableFor(grant, wallet)
	return {
		id: spec.id,
		label: spec.label,
		conditions: spec.conditions,
		outcome: spec.outcome,
		enabled: unavailable === undefined && allMet(spec.conditions),
		...(spec.danger === true ? { tone: "danger" as const } : {}),
		...(unavailable === undefined ? {} : { unavailable }),
	}
}

const vaultSpecs = (state: SettledState): [Spec, Spec] => [
	{
		id: "pause-vault",
		label: "Pause the vault",
		conditions: [pauseIs("Vault is open", state.vault, "open")],
		outcome:
			"Stops new deposits, pricing and upgrades. Redemptions, claims, cancels and closing epochs stay open.",
		danger: true,
	},
	{
		id: "unpause-vault",
		label: "Unpause the vault",
		conditions: [pauseIs("Vault is paused", state.vault, "paused")],
		outcome:
			"Resumes deposits, pricing and upgrades. A pending upgrade waits longer by the time the vault spent paused.",
	},
]

const oracleAdminSpecs = (state: SettledState): [Spec, Spec] => [
	{
		id: "lower-ripcord",
		label: "Lower the ripcord",
		conditions: [ripcordRaised(state.oracle)],
		outcome:
			"Resumes pricing: epochs can be fulfilled again while the price is valid.",
	},
	{
		id: "clear-latest",
		label: "Clear the latest price",
		conditions: [ripcordRaised(state.oracle)],
		outcome:
			"Removes the recorded price, so the next attestation is not limited by its distance from the last. Pricing stays stopped until the ripcord is lowered.",
		danger: true,
	},
]

const tokenSpecs = (state: SettledState): [Spec, Spec] => [
	{
		id: "pause-token",
		label: "Pause the share token",
		conditions: [pauseIs("Share token is open", state.token, "open")],
		outcome:
			"Stops holder transfers and redeem cancellations. Minting, burning and forced transfers stay open.",
		danger: true,
	},
	{
		id: "unpause-token",
		label: "Unpause the share token",
		conditions: [pauseIs("Share token is paused", state.token, "paused")],
		outcome: "Resumes holder transfers and redeem cancellations.",
	},
]

const raiseGrant = (
	guardian: Grant | undefined,
	admin: Grant | undefined,
	wallet: string,
): Grant | undefined => {
	if (guardian !== undefined && unavailableFor(guardian, wallet) === undefined)
		return guardian
	if (admin !== undefined && unavailableFor(admin, wallet) === undefined)
		return admin
	return guardian ?? admin
}

function toRaiseAction(
	state: SettledState,
	grant: Grant,
	wallet: string,
): EmergencyAction {
	const unavailable = unavailableFor(grant, wallet)
	return {
		id: "raise-ripcord",
		viaAdmin: grant.role === ROLES.oracleAdmin,
		label: "Raise the ripcord",
		conditions: [],
		outcome:
			"Stops pricing: no epoch can be fulfilled until it is lowered. Attesting stays open.",
		...(state.oracle === "paused" ? { note: "Ripcord already raised." } : {}),
		enabled: unavailable === undefined,
		tone: "danger",
		...(unavailable === undefined ? {} : { unavailable }),
	}
}

const isSettled = (state: EmergencyState): state is SettledState =>
	state.vault !== "checking" &&
	state.token !== "checking" &&
	state.oracle !== "checking"

export function toEmergencyActions(
	state: EmergencyState,
	grants: Grant[],
	wallet: string,
): EmergencyAction[] {
	if (!isSettled(state) || grants.length === 0) return []
	const held = (role: string) => grantFor(grants, role, wallet)
	const [pauseVault, unpauseVault] = vaultSpecs(state)
	const [lower, clear] = oracleAdminSpecs(state)
	const [pauseToken, unpauseToken] = tokenSpecs(state)
	const oracleAdmin = held(ROLES.oracleAdmin)
	const tokenAdmin = held(ROLES.tokenAdmin)
	const raiser = raiseGrant(held(ROLES.oracleGuardian), oracleAdmin, wallet)

	const actions: EmergencyAction[] = []
	const guardian = held(ROLES.vaultGuardian)
	if (guardian !== undefined)
		actions.push(toAction(pauseVault, guardian, wallet))
	const governance = held(ROLES.governance)
	if (governance !== undefined)
		actions.push(toAction(unpauseVault, governance, wallet))
	if (raiser !== undefined) actions.push(toRaiseAction(state, raiser, wallet))
	if (oracleAdmin !== undefined)
		actions.push(
			toAction(lower, oracleAdmin, wallet),
			toAction(clear, oracleAdmin, wallet),
		)
	if (tokenAdmin !== undefined)
		actions.push(
			toAction(pauseToken, tokenAdmin, wallet),
			toAction(unpauseToken, tokenAdmin, wallet),
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
		note: oracle === "paused" ? "Ripcord raised" : "Ripcord not raised",
	}
}

export const toEmergencyTiles = (state: EmergencyState): Metric[] => [
	pauseTile("Vault", state.vault),
	pauseTile("Share token", state.token),
	oracleTile(state.oracle),
]

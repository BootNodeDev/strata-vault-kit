import { shortAddress } from "@stellar-scaffold/app-lib"
import { type Grant, type Standing } from "../hooks/useAdminAuthority"

export type Condition = { label: string; met: boolean | null; detail?: string }

export type ActionField = {
	label: string
	placeholder: string
	value: string
	invalid: boolean
	max?: string
}

export type RailAction = {
	id: string
	label: string
	conditions: Condition[]
	outcome: string | null
	note?: string
	field?: ActionField
	enabled: boolean
	unavailable?: string
	tone?: "danger"
}

export type Readiness =
	| { kind: "ready" }
	| { kind: "unmet"; count: number }
	| { kind: "unavailable"; reason: string }

export const readiness = (action: RailAction): Readiness => {
	if (action.enabled) return { kind: "ready" }
	if (action.unavailable !== undefined)
		return { kind: "unavailable", reason: action.unavailable }
	return {
		kind: "unmet",
		count: action.conditions.filter((condition) => condition.met !== true)
			.length,
	}
}

export const readyCount = (actions: RailAction[]): number =>
	actions.filter((action) => action.enabled).length

export const allMet = (conditions: Condition[]): boolean =>
	conditions.every((condition) => condition.met === true)

const signaturesNeeded = (standing: Standing): number | null => {
	if (standing === "signs-alone") return null
	return "needs" in standing ? standing.needs : standing.threshold
}

export const grantFor = (
	grants: Grant[],
	role: string,
	wallet: string,
): Grant | undefined => {
	const ofRole = grants.filter((grant) => grant.role === role)
	return ofRole.find((grant) => grant.authority === wallet) ?? ofRole[0]
}

export const unavailableFor = (
	grant: Grant,
	wallet: string,
): string | undefined => {
	const needed = signaturesNeeded(grant.standing)
	if (needed !== null)
		return `Needs ${needed} signatures; collecting them is not supported yet.`
	if (grant.authority !== wallet)
		return `Signs for ${shortAddress(grant.authority)}; acting on its behalf is not supported yet.`
	return undefined
}

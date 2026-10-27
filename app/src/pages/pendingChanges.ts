import { Buffer } from "buffer"
import { shortAddress } from "@stellar-scaffold/app-lib"
import { type Metric } from "../components/vault/MetricsStrip"
import { type TimelockedContract } from "../hooks/useSetupOpen"
import {
	allMet,
	type BuiltSpec,
	type Condition,
	confirmation,
	confirmKey,
	type Inputs,
	parseAccount,
	type RailField,
} from "./actions"
import { formatDuration, formatTimestamp } from "./cycle"

export type PendingChange = {
	id: number
	change: { tag: string; values: readonly unknown[] }
	eta: bigint
}

export type ChangeName = { kind: string; value: string; full: string }

type Kind = { label: string; join: string; effect?: (value: string) => string }

const becomes = (label: string) => (value: string) =>
	`${label} becomes ${value}.`

const KINDS: Record<string, Kind> = {
	Upgrade: { label: "Code upgrade", join: " " },
	UpgradeDelay: {
		label: "Upgrade delay",
		join: " ",
		effect: becomes("Upgrade delay"),
	},
	Custodian: { label: "Custodian", join: " ", effect: becomes("Custodian") },
	Notice: { label: "Notice", join: " ", effect: becomes("Notice") },
	WindDownDelay: {
		label: "Wind-down delay",
		join: " ",
		effect: becomes("Wind-down delay"),
	},
	GrantRole: {
		label: "Grant role",
		join: " to ",
		effect: (value) => `Grants ${value}.`,
	},
	RevokeRole: {
		label: "Revoke role",
		join: " from ",
		effect: (value) => `Revokes ${value}.`,
	},
	Admin: {
		label: "Admin hand-over",
		join: " ",
		effect: (value) => `Offers the admin to ${value}.`,
	},
	Oracle: { label: "Oracle", join: " ", effect: becomes("Oracle") },
	Compliance: {
		label: "Compliance contract",
		join: " ",
		effect: becomes("Compliance contract"),
	},
	IdentityVerifier: {
		label: "Identity verifier",
		join: " ",
		effect: becomes("Identity verifier"),
	},
}

export const QUEUES = {
	vault: { name: "vault", apply: "apply-change", cancel: "cancel-change" },
	token: {
		name: "share token",
		apply: "apply-token-change",
		cancel: "cancel-token-change",
	},
} as const satisfies Record<
	TimelockedContract,
	{ name: string; apply: string; cancel: string }
>

type Queue = (typeof QUEUES)[TimelockedContract]

const shown = (value: unknown, full: boolean): string => {
	if (Buffer.isBuffer(value)) {
		const hex = value.toString("hex")
		return full ? hex : shortAddress(hex)
	}
	if (typeof value === "bigint") return formatDuration(value)
	if (typeof value === "string" && !full && parseAccount(value) !== undefined)
		return shortAddress(value)
	return String(value)
}

const kindOf = (tag: string): Kind => KINDS[tag] ?? { label: tag, join: " " }

export const describeChange = ({
	tag,
	values,
}: PendingChange["change"]): ChangeName => {
	const { label, join } = kindOf(tag)
	return {
		kind: label,
		value: values.map((value) => shown(value, false)).join(join),
		full: values.map((value) => shown(value, true)).join(join),
	}
}

export const changeName = (
	contract: string,
	pending: PendingChange,
): string => {
	const { kind, value } = describeChange(pending.change)
	return `${contract} change #${pending.id}: ${`${kind} ${value}`.trim()}`
}

export const pendingChangeMetrics = (
	changes: PendingChange[] | undefined,
): Metric[] => {
	if (changes === undefined)
		return [
			{ label: "Pending changes", value: null, note: "Could not be read" },
		]
	return changes.map(({ id, change, eta }) => {
		const { kind, value, full } = describeChange(change)
		return {
			label: `#${id} ${kind}`,
			value,
			...(full === value ? {} : { title: full }),
			note: `ETA ${formatTimestamp(eta)}`,
		}
	})
}

export function applyChangeSpec<Q extends Queue>(
	queue: Q,
	pending: PendingChange,
	now: bigint | null,
	checks: Condition[],
	inputs: Inputs,
): BuiltSpec<Q["apply"], number> {
	const slot = `${queue.apply}-${pending.id}`
	const { value, full } = describeChange(pending.change)
	const conditions: Condition[] = [
		{
			label: "ETA reached",
			met: now === null ? null : now >= pending.eta,
			detail: formatTimestamp(pending.eta),
		},
		...checks,
	]
	const fields: RailField[] = []
	const code = pending.change.tag === "Upgrade"
	if (code) {
		const confirm = confirmation(
			confirmKey(slot),
			`Replaces the ${queue.name}'s code with ${full}.`,
			full,
			inputs,
		)
		fields.push(confirm.field)
		conditions.push(confirm.condition)
	}
	return {
		id: queue.apply,
		slot,
		label: `Apply the change #${pending.id}`,
		conditions,
		outcome: kindOf(pending.change.tag).effect?.(value) ?? null,
		fields,
		...(code ? { danger: true } : {}),
		ready: allMet(conditions),
		arg: pending.id,
		next: changeName(queue.name, pending),
	}
}

export const cancelChangeSpec = <Q extends Queue>(
	queue: Q,
	pending: PendingChange,
): BuiltSpec<Q["cancel"], number> => ({
	id: queue.cancel,
	slot: `${queue.cancel}-${pending.id}`,
	label: `Cancel the change #${pending.id}`,
	conditions: [],
	outcome: null,
	arg: pending.id,
	next: changeName(queue.name, pending),
})

import { Buffer } from "buffer"
import { describe, expect, it } from "vitest"
import { type Condition, type Inputs } from "./actions"
import { formatTimestamp } from "./cycle"
import {
	applyChangeSpec,
	cancelChangeSpec,
	describeChange,
	type PendingChange,
	pendingChangeMetrics,
	QUEUES,
} from "./pendingChanges"

const ACCOUNT = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"
const FEED = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3"
const HASH = "ab".repeat(32)
const DAY = 86_400n
const NOW = 1_700_000_000n

const pending = (
	change: PendingChange["change"],
	eta = NOW,
	id = 3,
): PendingChange => ({ id, change, eta })

const custodian = pending({ tag: "Custodian", values: [ACCOUNT] })
const upgrade = pending({ tag: "Upgrade", values: [Buffer.from(HASH, "hex")] })

describe("describeChange", () => {
	it.each<[PendingChange["change"], string, string]>([
		[upgrade.change, "Code upgrade", "abab...abab"],
		[{ tag: "UpgradeDelay", values: [14n * DAY] }, "Upgrade delay", "14d"],
		[{ tag: "Custodian", values: [ACCOUNT] }, "Custodian", "GABA...EJXA"],
		[{ tag: "Notice", values: [DAY] }, "Notice", "1d"],
		[{ tag: "WindDownDelay", values: [8n * DAY] }, "Wind-down delay", "8d"],
		[
			{ tag: "MinEpochDuration", values: [7n * DAY] },
			"Minimum epoch duration",
			"7d",
		],
		[
			{ tag: "GrantRole", values: ["manager", ACCOUNT] },
			"Grant role",
			"manager to GABA...EJXA",
		],
		[
			{ tag: "RevokeRole", values: ["manager", ACCOUNT] },
			"Revoke role",
			"manager from GABA...EJXA",
		],
		[{ tag: "Admin", values: [ACCOUNT] }, "Admin hand-over", "GABA...EJXA"],
		[{ tag: "Oracle", values: [FEED] }, "Oracle", "CABQ...GCK3"],
		[
			{ tag: "Compliance", values: [FEED] },
			"Compliance contract",
			"CABQ...GCK3",
		],
		[
			{ tag: "IdentityVerifier", values: [FEED] },
			"Identity verifier",
			"CABQ...GCK3",
		],
		[
			{
				tag: "Config",
				values: [
					{
						freshness_duration: DAY,
						cooldown_secs: 3_600n,
						max_up_bps: 1_000,
						max_down_bps: 250,
						min_answer: 500_000_000_000_000_000n,
						max_answer: 2_000_000_000_000_000_000n,
					},
				],
			},
			"Oracle limits",
			"freshness window 1d, cooldown 1h, largest rise 10%, largest fall 2.5%, price floor 0.5000, price ceiling 2.0000",
		],
	])("names %o as %s %s", (change, kind, value) => {
		expect(describeChange(change)).toMatchObject({ kind, value })
	})

	it("keeps the full hash and address for where there is room", () => {
		expect(describeChange(upgrade.change).full).toBe(HASH)
		expect(describeChange(custodian.change).full).toBe(ACCOUNT)
	})

	it("falls back to the tag for a kind it does not know", () => {
		expect(describeChange({ tag: "Fee", values: [] })).toMatchObject({
			kind: "Fee",
		})
	})
})

describe("pendingChangeMetrics", () => {
	it("lists every pending change with its id, kind and eta", () => {
		expect(pendingChangeMetrics([custodian, { ...upgrade, id: 4 }])).toEqual([
			{
				label: "#3 Custodian",
				value: "GABA...EJXA",
				title: ACCOUNT,
				note: `ETA ${formatTimestamp(NOW)}`,
			},
			{
				label: "#4 Code upgrade",
				value: "abab...abab",
				title: HASH,
				note: `ETA ${formatTimestamp(NOW)}`,
			},
		])
	})

	it("shows nothing when nothing waits and says so when unreadable", () => {
		expect(pendingChangeMetrics([])).toEqual([])
		expect(pendingChangeMetrics(undefined)).toEqual([
			{ label: "Pending changes", value: null, note: "Could not be read" },
		])
	})
})

describe("applyChangeSpec", () => {
	const paused: Condition = { label: "Vault not paused", met: false }

	it("applies a change once its eta is reached, passing the contract's own checks", () => {
		const early = applyChangeSpec(QUEUES.vault, custodian, NOW - 1n, [], {})
		const due = applyChangeSpec(QUEUES.vault, custodian, NOW, [], {})
		const blocked = applyChangeSpec(QUEUES.vault, custodian, NOW, [paused], {})

		expect(early.conditions[0]).toEqual({
			label: "ETA reached",
			met: false,
			detail: formatTimestamp(NOW),
		})
		expect(due).toMatchObject({
			id: "apply-change",
			slot: "apply-change-3",
			label: "Apply the change #3",
			ready: true,
			arg: 3,
			next: "vault change #3: Custodian GABA...EJXA",
			outcome: "Custodian becomes GABA...EJXA.",
		})
		expect(blocked.conditions).toContainEqual(paused)
		expect(blocked.ready).toBe(false)
	})

	it("applies a share-token change under its own id and slot", () => {
		const compliance = pending({ tag: "Compliance", values: [FEED] })

		expect(
			applyChangeSpec(QUEUES.token, compliance, NOW, [], {}),
		).toMatchObject({
			id: "apply-token-change",
			slot: "apply-token-change-3",
			label: "Apply the change #3",
			arg: 3,
			next: "share token change #3: Compliance contract CABQ...GCK3",
			outcome: "Compliance contract becomes CABQ...GCK3.",
		})
		expect(
			applyChangeSpec(QUEUES.token, upgrade, NOW, [], {}).fields?.[0]?.label,
		).toBe(`Replaces the share token's code with ${HASH}.`)
	})

	it("holds the eta unknown until the clock is read", () => {
		expect(
			applyChangeSpec(QUEUES.vault, custodian, null, [], {}).conditions[0]?.met,
		).toBeNull()
	})

	it("asks to confirm a code upgrade by its full hash", () => {
		const draft = applyChangeSpec(QUEUES.vault, upgrade, NOW, [], {})
		const confirm = draft.fields?.find((field) => field.kind === "confirm")
		const inputs: Inputs = { [confirm?.key ?? ""]: confirm?.value ?? "" }

		expect(confirm?.label).toBe(`Replaces the vault's code with ${HASH}.`)
		expect(draft.danger).toBe(true)
		expect(draft.ready).toBe(false)
		expect(applyChangeSpec(QUEUES.vault, upgrade, NOW, [], inputs).ready).toBe(
			true,
		)
	})
})

describe("cancelChangeSpec", () => {
	it("cancels a change by its id at any time", () => {
		expect(cancelChangeSpec(QUEUES.vault, custodian)).toMatchObject({
			id: "cancel-change",
			slot: "cancel-change-3",
			label: "Cancel the change #3",
			conditions: [],
			arg: 3,
			next: "vault change #3: Custodian GABA...EJXA",
		})
	})

	it("cancels a share-token change under its own id and slot", () => {
		expect(cancelChangeSpec(QUEUES.token, custodian)).toMatchObject({
			id: "cancel-token-change",
			slot: "cancel-token-change-3",
			arg: 3,
		})
	})
})

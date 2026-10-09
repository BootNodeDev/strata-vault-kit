import {
	type Amount,
	type ChainEvent,
	type Price,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import {
	type CycleGroup,
	type ListState,
} from "../components/admin/CycleSurface"
import { type Grant } from "../hooks/useAdminAuthority"
import {
	type CycleEpoch,
	type CycleOracle,
	type CycleReserve,
	type CycleState,
	type CycleWindDown,
} from "../hooks/useCycleState"
import {
	type EpochHistoryRead,
	type EpochRecord,
} from "../hooks/useEpochHistory"
import {
	type CycleAction,
	formatDuration,
	toActivityList,
	toCycleActions,
	toCycleRows,
	toEpochList,
} from "./cycle"

const rowsOf = <T>(list: ListState<T>): T[] =>
	list.status === "loaded" ? list.rows : []

const activityOf = (events: ChainEvent[]) =>
	rowsOf(toActivityList({ status: "loaded", events, partial: false }))

const NOW = 1_700_100_000n
const amount = (whole: bigint) => (whole * 10_000_000n) as Amount
const price = (whole: bigint) => (whole * 10n ** 18n) as Price

const sealed: EpochRecord = {
	id: 4n,
	status: "Pending",
	totalDeposited: amount(300n),
	totalSharesRedeeming: amount(20n),
	sharePrice: null,
	closedAt: 1_700_000_000n,
	priceableAt: 1_700_003_600n,
}

const open: EpochRecord = {
	id: 5n,
	status: "Open",
	totalDeposited: amount(40n),
	totalSharesRedeeming: amount(0n),
	sharePrice: null,
	closedAt: 0n,
	priceableAt: 0n,
}

const epoch: CycleEpoch = {
	id: 5n,
	open,
	awaiting: sealed,
	awaitingKnown: true,
	noticeSeconds: 3_600n,
}

const oracle: CycleOracle = {
	state: "valid",
	price: price(1n),
	attestedAt: 1_700_050_000n,
	expiresAt: 1_700_136_000n,
	ripcord: false,
	limits: {
		freshness: 86_400n,
		cooldown: 3_600n,
		maxUpBps: 500,
		maxDownBps: null,
		min: price(1n) / 2n,
		max: price(2n),
	},
}

const reserve: CycleReserve = {
	free: amount(900n),
	committed: amount(100n),
	uncovered: amount(0n),
	liquid: amount(800n),
	netDeployed: amount(200n),
	depositCap: { kind: "capped", amount: amount(5_000n) },
	custodian: "CCUSTODIAN1234567890",
	custodianBalance: amount(150n),
}

const windDown: CycleWindDown = {
	phase: "none",
	activeAt: null,
	round: null,
	delay: 604_800n,
	owed: amount(0n),
	supply: amount(0n),
}

type ReadyState = Extract<CycleState, { status: "ready" }>

const ready = (overrides: Partial<ReadyState>) =>
	({
		status: "ready",
		ledgerTime: NOW,
		epoch,
		oracle,
		reserve,
		windDown,
		paused: "open",
		...overrides,
	}) satisfies CycleState

const groupOf = (groups: CycleGroup[], title: string) =>
	groups.find((group) => group.title === title)

const valueOf = (groups: CycleGroup[], title: string, label: string) =>
	groupOf(groups, title)?.rows.find((row) => row.label === label)?.value

const tileOf = (groups: CycleGroup[], title: string, label: string) =>
	groupOf(groups, title)?.tiles.find((tile) => tile.label === label)

describe("toCycleRows", () => {
	it("groups the state into Epoch, Price, Reserve and Wind-down", () => {
		const groups = toCycleRows(ready({}))

		expect(groups.map((group) => group.title)).toEqual([
			"Epoch",
			"Price",
			"Reserve",
			"Wind-down",
		])
	})

	it("leads each group with headline tiles and keeps the rest as detail rows", () => {
		const groups = toCycleRows(ready({}))

		expect(
			groups.map((group) => group.tiles.map((tile) => tile.label)),
		).toEqual([
			[
				"Open epoch",
				"Awaiting price",
				"Deposits requested",
				"Redemptions requested",
			],
			["Share price", "Attested", "Valid until"],
			["Free", "Uncovered", "Net deployed", "Custodian balance"],
			["Status", "Round", "Owed"],
		])
		expect(groups.map((group) => group.rows.map((row) => row.label))).toEqual([
			["Vault", "Notice period", "Sealed at", "Notice"],
			[
				"Ripcord",
				"Freshness window",
				"Cooldown",
				"Largest rise",
				"Largest fall",
				"Price floor",
				"Price ceiling",
			],
			["Committed", "Liquid reserve", "Deposit cap"],
			["Activates at", "Delay", "Supply"],
		])
	})

	it("shows pending tiles and rows with the same labels while the state is being read", () => {
		const pending = toCycleRows({ status: "checking" })
		const labelled = toCycleRows(ready({}))
		const labelsOf = (groups: CycleGroup[]) =>
			groups.map((group) => [
				group.tiles.map((tile) => tile.label),
				group.rows.map((row) => row.label),
			])

		expect(labelsOf(pending)).toEqual(labelsOf(labelled))
		expect(
			pending.every(
				(group) =>
					group.tiles.every((tile) => tile.pending) &&
					group.rows.every((row) => row.pending),
			),
		).toBe(true)
	})

	it("headlines the open epoch and what it has requested", () => {
		const groups = toCycleRows(ready({}))

		expect(tileOf(groups, "Epoch", "Open epoch")?.value).toBe("5")
		expect(tileOf(groups, "Epoch", "Awaiting price")?.value).toBe("4")
		expect(tileOf(groups, "Epoch", "Deposits requested")?.value).toBe("40.00")
		expect(tileOf(groups, "Epoch", "Redemptions requested")?.value).toBe("0.00")
	})

	it("has nothing to show when the state is unreadable", () => {
		expect(toCycleRows({ status: "unreadable" })).toEqual([])
	})

	it.each<[string, Partial<Extract<CycleState, { status: "ready" }>>, string]>([
		[
			"notice still running",
			{ ledgerTime: 1_700_001_000n },
			"Elapses 14 Nov, 23:13 UTC",
		],
		["notice elapsed", { ledgerTime: NOW }, "Elapsed"],
		["ledger time unknown", { ledgerTime: null }, "Unavailable"],
	])("reports %s on the sealed epoch", (_name, overrides, expected) => {
		const value = valueOf(toCycleRows(ready(overrides)), "Epoch", "Notice")

		expect(value ?? "Unavailable").toBe(expected)
	})

	it("shows no sealed epoch awaiting a price when none is sealed", () => {
		const groups = toCycleRows(ready({ epoch: { ...epoch, awaiting: null } }))

		expect(tileOf(groups, "Epoch", "Awaiting price")?.value).toBe("None")
		expect(valueOf(groups, "Epoch", "Notice")).toBe("—")
	})

	it("does not claim nothing is awaiting a price when some epochs were unreadable", () => {
		const groups = toCycleRows(
			ready({ epoch: { ...epoch, awaiting: null, awaitingKnown: false } }),
		)

		expect(tileOf(groups, "Epoch", "Awaiting price")?.value).toBeNull()
	})

	it.each<[string, CycleOracle["state"], string]>([
		["a valid price", "valid", "Valid"],
		["a stale price", "stale", "Stale"],
		["a raised ripcord", "paused", "Paused"],
	])("notes %s under the share price", (_name, state, expected) => {
		const groups = toCycleRows(
			ready({
				oracle: { ...oracle, state, ripcord: state === "paused" },
			}),
		)

		expect(tileOf(groups, "Price", "Share price")).toMatchObject({
			value: "1.0000",
			note: expected,
		})
	})

	it("says no price was attested yet in place of a share price", () => {
		const groups = toCycleRows(
			ready({
				oracle: {
					...oracle,
					state: "never",
					price: null,
					attestedAt: null,
					expiresAt: null,
				},
			}),
		)

		expect(tileOf(groups, "Price", "Share price")).toMatchObject({
			value: null,
			note: "None attested",
		})
		expect(tileOf(groups, "Price", "Attested")?.value).toBe("—")
		expect(tileOf(groups, "Price", "Valid until")?.value).toBe("—")
	})

	it("headlines when the price was attested and until when it is valid", () => {
		const groups = toCycleRows(ready({}))

		expect(tileOf(groups, "Price", "Attested")?.value).toBe("15 Nov, 12:06 UTC")
		expect(tileOf(groups, "Price", "Valid until")?.value).toBe(
			"16 Nov, 12:00 UTC",
		)
	})

	it("shows the ripcord, the share price and the oracle limits in app units", () => {
		const groups = toCycleRows(ready({}))

		expect(tileOf(groups, "Price", "Share price")?.value).toBe("1.0000")
		expect(valueOf(groups, "Price", "Ripcord")).toBe("Not raised")
		expect(valueOf(groups, "Price", "Cooldown")).toBe("1h")
		expect(valueOf(groups, "Price", "Freshness window")).toBe("1d")
		expect(valueOf(groups, "Price", "Largest rise")).toBe("5%")
		expect(valueOf(groups, "Price", "Largest fall")).toBe("No limit")
		expect(valueOf(groups, "Price", "Price floor")).toBe("0.5000")
	})

	it("leaves a price the oracle could not give as unavailable", () => {
		const groups = toCycleRows(
			ready({
				oracle: { ...oracle, state: "unreadable", price: null, limits: null },
			}),
		)

		expect(tileOf(groups, "Price", "Share price")).toEqual({
			label: "Share price",
			value: null,
		})
		expect(tileOf(groups, "Price", "Attested")?.value).toBeNull()
		expect(valueOf(groups, "Price", "Cooldown")).toBeNull()
	})

	it.each<[string, bigint, string]>([
		["covered", 0n, "Covered"],
		["uncovered", 250n, "250.00 short"],
	])("says when claims are %s", (_name, uncovered, expected) => {
		const groups = toCycleRows(
			ready({ reserve: { ...reserve, uncovered: amount(uncovered) } }),
		)

		expect(tileOf(groups, "Reserve", "Uncovered")?.note).toBe(expected)
	})

	it("shows the reserve figures, the deposit cap and the custodian", () => {
		const groups = toCycleRows(ready({}))

		expect(tileOf(groups, "Reserve", "Free")?.value).toBe("900.00")
		expect(tileOf(groups, "Reserve", "Uncovered")?.value).toBe("0.00")
		expect(tileOf(groups, "Reserve", "Net deployed")?.value).toBe("200.00")
		expect(tileOf(groups, "Reserve", "Custodian balance")?.value).toBe("150.00")
		expect(valueOf(groups, "Reserve", "Committed")).toBe("100.00")
		expect(valueOf(groups, "Reserve", "Liquid reserve")).toBe("800.00")
		expect(valueOf(groups, "Reserve", "Deposit cap")).toBe("5,000.00")
		expect(
			groups.find((group) => group.title === "Reserve")?.addresses,
		).toEqual([{ label: "Custodian", address: "CCUSTODIAN1234567890" }])
	})

	it("reads an unset deposit cap as no cap", () => {
		const groups = toCycleRows(
			ready({ reserve: { ...reserve, depositCap: { kind: "uncapped" } } }),
		)

		expect(valueOf(groups, "Reserve", "Deposit cap")).toBe("No cap")
	})

	it("shows a wind-down that is not proposed", () => {
		const groups = toCycleRows(ready({}))

		expect(tileOf(groups, "Wind-down", "Status")?.value).toBe("None")
		expect(tileOf(groups, "Wind-down", "Round")?.value).toBe("—")
		expect(valueOf(groups, "Wind-down", "Activates at")).toBe("—")
		expect(valueOf(groups, "Wind-down", "Delay")).toBe("7d")
	})

	it("shows a proposed wind-down with the time it can start", () => {
		const groups = toCycleRows(
			ready({
				windDown: {
					...windDown,
					phase: "proposed",
					activeAt: 1_700_200_000n,
					round: 0,
				},
			}),
		)

		expect(tileOf(groups, "Wind-down", "Status")?.value).toBe("Proposed")
		expect(valueOf(groups, "Wind-down", "Activates at")).toBe(
			"17 Nov, 05:46 UTC",
		)
	})

	it("shows an active wind-down with its round and what it owes", () => {
		const groups = toCycleRows(
			ready({
				windDown: {
					...windDown,
					phase: "active",
					activeAt: 1_700_000_000n,
					round: 2,
					owed: amount(75n),
					supply: amount(60n),
				},
			}),
		)

		expect(tileOf(groups, "Wind-down", "Status")?.value).toBe("Active")
		expect(tileOf(groups, "Wind-down", "Round")?.value).toBe("2")
		expect(tileOf(groups, "Wind-down", "Owed")?.value).toBe("75.00")
		expect(valueOf(groups, "Wind-down", "Supply")).toBe("60.00")
	})

	it("says whether the vault is accepting requests", () => {
		expect(valueOf(toCycleRows(ready({})), "Epoch", "Vault")).toBe(
			"Accepting requests",
		)
		expect(
			valueOf(toCycleRows(ready({ paused: "paused" })), "Epoch", "Vault"),
		).toBe("Paused")
	})
})

describe("formatDuration", () => {
	it.each<[bigint, string]>([
		[0n, "0s"],
		[45n, "45s"],
		[3_600n, "1h"],
		[5_400n, "1h 30m"],
		[93_600n, "1d 2h"],
		[604_800n, "7d"],
	])("formats %s seconds as %s", (seconds, expected) => {
		expect(formatDuration(seconds)).toBe(expected)
	})
})

describe("toEpochList", () => {
	const loaded = (
		epochs: EpochRecord[],
		absent: bigint[] = [],
		unreadable: bigint[] = [],
	): EpochHistoryRead => ({
		status: "loaded",
		currentEpoch: 5n,
		epochs,
		absent,
		unreadable,
	})

	it("labels each epoch with app vocabulary and shows a price only once priced", () => {
		const priced: EpochRecord = {
			...sealed,
			id: 3n,
			status: "Fulfilled",
			sharePrice: (price(1n) + price(1n) / 4n) as Price,
		}

		expect(rowsOf(toEpochList(loaded([open, sealed, priced])))).toEqual([
			{
				id: "5",
				status: "Open",
				deposited: "40.00",
				redeeming: "0.00",
				price: "—",
			},
			{
				id: "4",
				status: "Sealed",
				deposited: "300.00",
				redeeming: "20.00",
				price: "—",
			},
			{
				id: "3",
				status: "Priced",
				deposited: "300.00",
				redeeming: "20.00",
				price: "1.2500",
			},
		])
	})

	it("passes on a history that is still being read or could not be", () => {
		expect(toEpochList({ status: "checking" })).toEqual({ status: "checking" })
		expect(toEpochList({ status: "unreadable" })).toEqual({
			status: "unreadable",
		})
	})

	it("notes archived epochs and epochs that could not be read", () => {
		const list = toEpochList(loaded([open], [1n, 2n], [3n]))

		expect(list).toMatchObject({
			note: "2 earlier epochs archived · 1 epoch could not be read.",
		})
	})

	it("has no note when every epoch was read", () => {
		expect(toEpochList(loaded([open]))).toMatchObject({ note: undefined })
	})
})

const event = (
	name: string,
	topics: unknown[],
	data: unknown,
	ledger: number,
): ChainEvent => ({
	contractId: "CCONTRACT",
	name,
	topics,
	data,
	ledger,
	closedAt: 1_700_000_000n + BigInt(ledger),
})

describe("toActivityList", () => {
	it("describes each cycle event and lists the newest first", () => {
		const rows = activityOf([
			event(
				"epoch_closed",
				[3n],
				{ total_deposited: amount(10n), total_shares_redeeming: amount(2n) },
				10,
			),
			event(
				"epoch_fulfilled",
				[3n],
				{ share_price: price(1n), total_deposited: amount(10n) },
				20,
			),
			event(
				"nav_attested",
				["GATTESTER1234567890"],
				{ nav_per_share: price(1n), expires_at: 99n },
				30,
			),
			event(
				"deposit_requested",
				["GINVESTOR1234567890"],
				{ epoch: 4n, amount: amount(5n) },
				40,
			),
			event(
				"deposit_claimed",
				["GINVESTOR1234567890"],
				{ epoch: 3n, amount: amount(5n), shares: amount(4n) },
				50,
			),
		])

		expect(rows.map((row) => [row.title, row.detail])).toEqual([
			[
				"Deposit claimed",
				[{ figure: "5.00" }, " from epoch 3 · ", { figure: "GINV...7890" }],
			],
			[
				"Deposit requested",
				[{ figure: "5.00" }, " in epoch 4 · ", { figure: "GINV...7890" }],
			],
			[
				"Price attested",
				[{ figure: "1.0000" }, " · ", { figure: "GATT...7890" }],
			],
			["Epoch 3 priced", ["Share price ", { figure: "1.0000" }]],
			[
				"Epoch 3 sealed",
				[
					{ figure: "10.00" },
					" deposited · ",
					{ figure: "2.00" },
					" shares redeeming",
				],
			],
		])
	})

	it("passes on events that are still being read or could not be", () => {
		expect(toActivityList({ status: "checking" })).toEqual({
			status: "checking",
		})
		expect(toActivityList({ status: "unreadable" })).toEqual({
			status: "unreadable",
		})
	})

	it("notes that only the most recent events are shown when the read was partial", () => {
		expect(
			toActivityList({ status: "loaded", events: [], partial: true }),
		).toMatchObject({ note: "Only part of the last 7 days is shown." })
		expect(
			toActivityList({ status: "loaded", events: [], partial: false }),
		).not.toHaveProperty("note", expect.any(String))
	})

	it("keeps only the latest ten", () => {
		const events = Array.from({ length: 12 }, (_, index) =>
			event(
				"epoch_closed",
				[BigInt(index)],
				{ total_deposited: amount(1n), total_shares_redeeming: amount(0n) },
				index + 1,
			),
		)

		const rows = activityOf(events)

		expect(rows).toHaveLength(10)
		expect(rows[0]?.title).toBe("Epoch 11 sealed")
	})

	it("skips an event it does not recognise or cannot decode", () => {
		const rows = activityOf([
			event("something_else", [], {}, 1),
			event("epoch_closed", [], null, 2),
		])

		expect(rows).toEqual([])
	})
})

const grant = (role: string, standing: Grant["standing"] = "signs-alone") => ({
	role,
	authority: "GAUTHORITY1234567890",
	standing,
})

const manager = grant("vault manager")
const treasury = grant("vault treasury")

const actionOf = (actions: CycleAction[], id: CycleAction["id"]) =>
	actions.find((action) => action.id === id)

const conditionsOf = (action: CycleAction | undefined) =>
	Object.fromEntries(
		(action?.conditions ?? []).map(({ label, met }) => [label, met]),
	)

describe("toCycleActions", () => {
	it("offers the manager both actions and any other cycle role only the settlement", () => {
		expect(
			toCycleActions(ready({}), [manager]).map((action) => action.id),
		).toEqual(["close-epoch", "fulfill-epoch"])
		expect(
			toCycleActions(ready({}), [treasury]).map((action) => action.id),
		).toEqual(["fulfill-epoch"])
	})

	it("offers nothing while the cycle is still being read or could not be", () => {
		expect(toCycleActions({ status: "checking" }, [manager])).toEqual([])
		expect(toCycleActions({ status: "unreadable" }, [manager])).toEqual([])
	})

	it("enables the close when the wind-down is not active and an epoch is open, naming what it seals and opens", () => {
		const close = actionOf(toCycleActions(ready({}), [manager]), "close-epoch")

		expect(close?.label).toBe("Close epoch")
		expect(conditionsOf(close)).toEqual({
			"Wind-down not active": true,
			"Epoch open": true,
		})
		expect(close?.outcome).toBe("Seals epoch 5 and opens epoch 6.")
		expect(close?.epochId).toBe(5n)
		expect(close?.enabled).toBe(true)
		expect(close?.unavailable).toBeUndefined()
	})

	it("disables the close while the wind-down is active", () => {
		const close = actionOf(
			toCycleActions(ready({ windDown: { ...windDown, phase: "active" } }), [
				manager,
			]),
			"close-epoch",
		)

		expect(conditionsOf(close)["Wind-down not active"]).toBe(false)
		expect(close?.enabled).toBe(false)
	})

	it("disables the close when no open epoch could be read", () => {
		const close = actionOf(
			toCycleActions(ready({ epoch: { ...epoch, open: null } }), [manager]),
			"close-epoch",
		)

		expect(conditionsOf(close)["Epoch open"]).toBe(false)
		expect(close?.enabled).toBe(false)
	})

	it("does not count an unreadable wind-down as inactive", () => {
		const close = actionOf(
			toCycleActions(ready({ windDown: { ...windDown, phase: null } }), [
				manager,
			]),
			"close-epoch",
		)

		expect(conditionsOf(close)["Wind-down not active"]).toBe(false)
	})

	it("makes the close unavailable when the manager's authority needs more signatures than the wallet's", () => {
		const close = actionOf(
			toCycleActions(ready({}), [grant("vault manager", { needs: 2 })]),
			"close-epoch",
		)

		expect(close?.unavailable).toBe(
			"Needs 2 signatures; collecting them is not supported yet.",
		)
		expect(close?.enabled).toBe(false)
	})

	it("reads the threshold as the signatures needed for a weighted authority", () => {
		const close = actionOf(
			toCycleActions(ready({}), [
				grant("vault manager", { weight: 1, threshold: 3 }),
			]),
			"close-epoch",
		)

		expect(close?.unavailable).toBe(
			"Needs 3 signatures; collecting them is not supported yet.",
		)
	})

	it("enables the settlement when every condition is met, pricing the oldest sealed epoch at the current price", () => {
		const fulfill = actionOf(
			toCycleActions(ready({}), [treasury]),
			"fulfill-epoch",
		)

		expect(fulfill?.label).toBe("Fulfill epoch")
		expect(conditionsOf(fulfill)).toEqual({
			"Sealed epoch awaiting a price": true,
			"Notice elapsed": true,
			"Price valid": true,
			"Attested after the close": true,
			"Vault not paused": true,
			"Wind-down not active": true,
		})
		expect(fulfill?.outcome).toBe(
			"Prices epoch 4 at 1.0000 and settles its requests.",
		)
		expect(fulfill?.epochId).toBe(4n)
		expect(fulfill?.enabled).toBe(true)
		expect(fulfill?.unavailable).toBeUndefined()
	})

	it("never asks a settlement for signatures, since anyone may run it", () => {
		const fulfill = actionOf(
			toCycleActions(ready({}), [grant("vault treasury", { needs: 2 })]),
			"fulfill-epoch",
		)

		expect(fulfill?.unavailable).toBeUndefined()
		expect(fulfill?.enabled).toBe(true)
	})

	it("disables the settlement with no outcome when nothing sealed awaits a price", () => {
		const fulfill = actionOf(
			toCycleActions(ready({ epoch: { ...epoch, awaiting: null } }), [
				treasury,
			]),
			"fulfill-epoch",
		)

		expect(conditionsOf(fulfill)["Sealed epoch awaiting a price"]).toBe(false)
		expect(conditionsOf(fulfill)["Notice elapsed"]).toBe(false)
		expect(conditionsOf(fulfill)["Attested after the close"]).toBe(false)
		expect(fulfill?.outcome).toBeNull()
		expect(fulfill?.epochId).toBeNull()
		expect(fulfill?.enabled).toBe(false)
	})

	it("disables the settlement while the notice has not elapsed", () => {
		const fulfill = actionOf(
			toCycleActions(ready({ ledgerTime: sealed.priceableAt - 1n }), [
				treasury,
			]),
			"fulfill-epoch",
		)

		expect(conditionsOf(fulfill)["Notice elapsed"]).toBe(false)
		expect(fulfill?.enabled).toBe(false)
	})

	it("treats the notice as elapsed the second it is due, and unknown without a ledger time", () => {
		expect(
			conditionsOf(
				actionOf(
					toCycleActions(ready({ ledgerTime: sealed.priceableAt }), [treasury]),
					"fulfill-epoch",
				),
			)["Notice elapsed"],
		).toBe(true)
		expect(
			conditionsOf(
				actionOf(
					toCycleActions(ready({ ledgerTime: null }), [treasury]),
					"fulfill-epoch",
				),
			)["Notice elapsed"],
		).toBe(false)
	})

	it.each<CycleOracle["state"]>(["stale", "paused", "never", "unreadable"])(
		"disables the settlement while the price is %s",
		(state) => {
			const fulfill = actionOf(
				toCycleActions(ready({ oracle: { ...oracle, state } }), [treasury]),
				"fulfill-epoch",
			)

			expect(conditionsOf(fulfill)["Price valid"]).toBe(false)
			expect(fulfill?.enabled).toBe(false)
		},
	)

	it("disables the settlement when the price was attested before the epoch was sealed", () => {
		const fulfill = actionOf(
			toCycleActions(
				ready({ oracle: { ...oracle, attestedAt: sealed.closedAt - 1n } }),
				[treasury],
			),
			"fulfill-epoch",
		)

		expect(conditionsOf(fulfill)["Attested after the close"]).toBe(false)
		expect(fulfill?.enabled).toBe(false)
	})

	it("accepts a price attested in the same second the epoch was sealed", () => {
		const fulfill = actionOf(
			toCycleActions(
				ready({ oracle: { ...oracle, attestedAt: sealed.closedAt } }),
				[treasury],
			),
			"fulfill-epoch",
		)

		expect(conditionsOf(fulfill)["Attested after the close"]).toBe(true)
	})

	it.each<ReadyState["paused"]>(["paused", "checking", "unreadable"])(
		"disables the settlement while the vault's pause reads %s",
		(paused) => {
			const fulfill = actionOf(
				toCycleActions(ready({ paused }), [treasury]),
				"fulfill-epoch",
			)

			expect(conditionsOf(fulfill)["Vault not paused"]).toBe(false)
			expect(fulfill?.enabled).toBe(false)
		},
	)

	it("keeps the outcome without a price figure when the oracle has none to show", () => {
		const fulfill = actionOf(
			toCycleActions(
				ready({ oracle: { ...oracle, state: "never", price: null } }),
				[treasury],
			),
			"fulfill-epoch",
		)

		expect(fulfill?.outcome).toBeNull()
	})
})

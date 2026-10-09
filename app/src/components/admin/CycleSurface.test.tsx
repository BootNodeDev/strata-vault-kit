import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import CycleSurface, {
	type ActivityRow,
	type CycleGroup,
	type EpochRow,
	type ListState,
} from "./CycleSurface"

vi.mock("@stellar-scaffold/app-lib", () => ({
	shortAddress: (address: string) =>
		`${address.slice(0, 4)}...${address.slice(-4)}`,
	explorerContract: (address: string) => `https://explorer.test/${address}`,
}))

const groups: CycleGroup[] = [
	{
		title: "Epoch",
		tiles: [
			{ label: "Open epoch", value: "5" },
			{ label: "Awaiting price", value: null },
		],
		rows: [
			{ label: "Notice period", value: "1h" },
			{ label: "Sealed at", value: null },
		],
	},
	{
		title: "Reserve",
		tiles: [{ label: "Uncovered", value: "0.00", note: "Covered" }],
		rows: [{ label: "Deposit cap", value: "No cap" }],
		addresses: [{ label: "Custodian", address: "CCUSTODIAN1234567890" }],
	},
]

const epochRows: EpochRow[] = [
	{
		id: "5",
		status: "Open",
		deposited: "40.00",
		redeeming: "0.00",
		price: "—",
	},
	{
		id: "4",
		status: "Priced",
		deposited: "300.00",
		redeeming: "20.00",
		price: "1.2500",
	},
]

const activityRows: ActivityRow[] = [
	{
		key: "2",
		title: "Deposit claimed",
		detail: [
			{ figure: "100.00" },
			" from epoch 4 · ",
			{ figure: "GC3B...MUBQ" },
		],
		when: "15 Nov 2023, 09:02 UTC",
	},
	{
		key: "1",
		title: "Epoch 4 priced",
		detail: ["Share price ", { figure: "1.2500" }],
		when: "14 Nov 2023, 22:13 UTC",
	},
]

const renderSurface = (
	overrides: {
		groups?: CycleGroup[]
		unreadable?: boolean
		epochs?: ListState<EpochRow>
		activity?: ListState<ActivityRow>
	} = {},
) =>
	render(
		<CycleSurface
			groups={overrides.groups ?? groups}
			unreadable={overrides.unreadable ?? false}
			epochs={overrides.epochs ?? { status: "loaded", rows: epochRows }}
			activity={overrides.activity ?? { status: "loaded", rows: activityRows }}
		/>,
	)

describe("CycleSurface", () => {
	it("leads each group with its tiles, an em dash standing in for an unreadable tile", () => {
		renderSurface()

		const openTile = screen.getByText("Open epoch").parentElement!
		expect(within(openTile).getByText("5")).toBeTruthy()
		const awaitingTile = screen.getByText("Awaiting price").parentElement!
		expect(within(awaitingTile).getByText("—")).toBeTruthy()
		expect(within(awaitingTile).queryByText("Unavailable")).toBeNull()
	})

	it("notes a secondary line under a tile that has one", () => {
		renderSurface()

		const tile = screen.getByText("Uncovered").parentElement!
		expect(within(tile).getByText("0.00")).toBeTruthy()
		expect(within(tile).getByText("Covered")).toBeTruthy()
	})

	it("lists the detail rows below the tiles as label and value, with unreadable values as Unavailable", () => {
		renderSurface()

		const [epochRowsList, reserveRowsList] = screen.getAllByRole("list")
		expect(within(epochRowsList!).getByText("Notice period")).toBeTruthy()
		expect(within(epochRowsList!).getByText("1h")).toBeTruthy()
		const row = within(epochRowsList!).getByText("Sealed at").closest("li")
		expect(within(row!).getByText("Unavailable")).toBeTruthy()
		expect(within(reserveRowsList!).getByText("Deposit cap")).toBeTruthy()
		expect(within(reserveRowsList!).getByText("No cap")).toBeTruthy()
		expect(within(epochRowsList!).queryByText("Open epoch")).toBeNull()
	})

	it("links the custodian to the explorer", () => {
		renderSurface()

		expect(
			screen.getByRole("link", { name: "CCUS...7890" }).getAttribute("href"),
		).toBe("https://explorer.test/CCUSTODIAN1234567890")
	})

	it("renders pending tiles and rows as loading indicators", () => {
		renderSurface({
			groups: [
				{
					title: "Epoch",
					tiles: [{ label: "Open epoch", value: null, pending: true }],
					rows: [{ label: "Notice period", value: null, pending: true }],
				},
			],
			epochs: { status: "loaded", rows: [] },
			activity: { status: "loaded", rows: [] },
		})

		expect(screen.getAllByRole("progressbar")).toHaveLength(2)
	})

	it("replaces the groups with one sentence when the cycle cannot be read", () => {
		renderSurface({ groups: [], unreadable: true })

		expect(screen.getByText("Could not read the vault's cycle.")).toBeTruthy()
		expect(screen.queryByText("Open epoch")).toBeNull()
	})

	it("lists the epochs in a table, one row each", () => {
		renderSurface()

		const table = screen.getByRole("table", { name: "Epochs" })
		expect(
			within(table)
				.getAllByRole("columnheader")
				.map((header) => header.textContent),
		).toEqual([
			"Epoch",
			"Status",
			"Deposited",
			"Shares redeeming",
			"Share price",
		])
		const [, open, priced] = within(table).getAllByRole("row")
		expect(
			within(open!)
				.getAllByRole("cell")
				.map((cell) => cell.textContent),
		).toEqual(["5", "Open", "40.00", "0.00", "—"])
		expect(
			within(priced!)
				.getAllByRole("cell")
				.map((cell) => cell.textContent),
		).toEqual(["4", "Priced", "300.00", "20.00", "1.2500"])
	})

	it("shows the epoch note under the table", () => {
		renderSurface({
			epochs: {
				status: "loaded",
				rows: epochRows,
				note: "2 earlier epochs archived.",
			},
		})

		expect(screen.getByText("2 earlier epochs archived.")).toBeTruthy()
	})

	it.each<[string, ListState<EpochRow>]>([
		["Could not read the epoch history.", { status: "unreadable" }],
		["No epochs yet.", { status: "loaded", rows: [] }],
	])("says %s instead of a table", (sentence, epochs) => {
		renderSurface({ epochs })

		expect(screen.getByText(sentence)).toBeTruthy()
		expect(screen.queryByRole("table", { name: "Epochs" })).toBeNull()
	})

	it("shows a skeleton while the epochs are being read", () => {
		renderSurface({ epochs: { status: "checking" } })

		expect(screen.getAllByRole("progressbar")).toHaveLength(1)
		expect(screen.queryByRole("table", { name: "Epochs" })).toBeNull()
	})

	it("labels the activity as the last 7 days and tables each entry as time, event and detail", () => {
		renderSurface()

		expect(screen.getByText("Recent activity — last 7 days")).toBeTruthy()
		const table = screen.getByRole("table", { name: "Recent activity" })
		expect(
			within(table)
				.getAllByRole("columnheader")
				.map((header) => header.textContent),
		).toEqual(["Time", "Event", "Detail"])
		const [, claimed, priced] = within(table).getAllByRole("row")
		expect(
			within(claimed!)
				.getAllByRole("cell")
				.map((cell) => cell.textContent),
		).toEqual([
			"15 Nov 2023, 09:02 UTC",
			"Deposit claimed",
			"100.00 from epoch 4 · GC3B...MUBQ",
		])
		expect(
			within(priced!)
				.getAllByRole("cell")
				.map((cell) => cell.textContent),
		).toEqual([
			"14 Nov 2023, 22:13 UTC",
			"Epoch 4 priced",
			"Share price 1.2500",
		])
	})

	it.each<[string, ListState<ActivityRow>]>([
		["Could not read recent activity.", { status: "unreadable" }],
		["No cycle activity in the last 7 days.", { status: "loaded", rows: [] }],
	])("says %s in place of the activity table", (sentence, activity) => {
		renderSurface({ activity })

		expect(screen.getByText(sentence)).toBeTruthy()
		expect(screen.getByText("Recent activity — last 7 days")).toBeTruthy()
		expect(screen.queryByRole("table", { name: "Recent activity" })).toBeNull()
	})

	it("heads each group and section with a sentence-case title below the card title", () => {
		renderSurface()

		expect(
			screen
				.getAllByRole("heading", { level: 3 })
				.map((heading) => heading.textContent),
		).toEqual(["Epoch", "Reserve", "Epochs", "Recent activity — last 7 days"])
	})
})

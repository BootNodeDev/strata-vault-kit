import {
	type ContractRead,
	type NavReport,
	type OracleState,
} from "@stellar-scaffold/app-lib"
import { describe, expect, it } from "vitest"
import { classifyNav, type NavClassification } from "./useNavPrice"

const valid: ContractRead<OracleState> = {
	kind: "value",
	value: { tag: "Valid", values: undefined },
}
const stale: ContractRead<OracleState> = {
	kind: "value",
	value: { tag: "Stale", values: undefined },
}
const paused: ContractRead<OracleState> = {
	kind: "value",
	value: { tag: "Paused", values: undefined },
}
const unreadableState: ContractRead<OracleState> = { kind: "unreadable" }

const report: NavReport = {
	nav_per_share: 1500000000000000000n,
	expires_at: 1800000000n,
	timestamp: 1757900000n,
}
const value: ContractRead<NavReport> = { kind: "value", value: report }
const notAttested: ContractRead<NavReport> = {
	kind: "contract-error",
	code: 3006,
}
const unreadableLatest: ContractRead<NavReport> = { kind: "unreadable" }

describe("classifyNav", () => {
	it.each<
		[
			string,
			ContractRead<OracleState>,
			ContractRead<NavReport>,
			NavClassification,
		]
	>([
		["state read fails", unreadableState, value, { status: "unreadable" }],
		["oracle paused", paused, value, { status: "paused" }],
		[
			"stale with no attestation on record",
			stale,
			notAttested,
			{ status: "never" },
		],
		[
			"stale with a readable report",
			stale,
			value,
			{ status: "stale", expiresAt: report.expires_at },
		],
		[
			"stale, latest read fails",
			stale,
			unreadableLatest,
			{ status: "unreadable" },
		],
		[
			"valid with a readable report",
			valid,
			value,
			{
				status: "valid",
				price: report.nav_per_share,
				attestedAt: report.timestamp,
			} as NavClassification,
		],
		[
			"valid, latest read fails",
			valid,
			unreadableLatest,
			{ status: "unreadable" },
		],
	])("%s", (_name, state, latest, expected) => {
		expect(classifyNav(state, latest)).toEqual(expected)
	})
})

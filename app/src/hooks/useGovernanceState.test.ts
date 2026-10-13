import type * as AppLib from "@stellar-scaffold/app-lib"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithWallet } from "./testSupport"
import { useGovernanceState } from "./useGovernanceState"

const { readPendingAdminsMock } = vi.hoisted(() => ({
	readPendingAdminsMock: vi.fn(),
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	readPendingAdmins: readPendingAdminsMock,
}))

const VAULT = "CVAULT"
const ORACLE = "CORACLE"
const TOKEN = "CTOKEN"
const LEDGER = {
	sequence: 1_000,
	closeTime: 1_700_000_000n,
	maxLiveUntil: null,
}
const TRANSFER = { address: "GNEXT", liveUntilLedger: 2_000, expired: false }

const render = () =>
	renderWithWallet(() =>
		useGovernanceState({
			contracts: { vault: VAULT, oracle: ORACLE, token: TOKEN },
		}),
	)

describe("useGovernanceState", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("files each contract's pending transfer under its own name", async () => {
		readPendingAdminsMock.mockResolvedValue({
			kind: "value",
			value: {
				ledger: LEDGER,
				pending: new Map([
					[VAULT, null],
					[ORACLE, TRANSFER],
					[TOKEN, null],
				]),
			},
		})
		const { result } = render()

		await waitFor(() => expect(result.current.handovers.status).toBe("ready"))
		expect(readPendingAdminsMock).toHaveBeenCalledWith([VAULT, ORACLE, TOKEN])
		expect(result.current.handovers).toEqual({
			status: "ready",
			ledger: LEDGER,
			pending: { vault: null, oracle: TRANSFER, token: null },
		})
	})

	it("reports unreadable when the ledger cannot be read", async () => {
		readPendingAdminsMock.mockResolvedValue({ kind: "unreadable" })
		const { result } = render()

		await waitFor(() =>
			expect(result.current.handovers.status).toBe("unreadable"),
		)
	})
})

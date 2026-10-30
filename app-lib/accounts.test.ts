import { beforeEach, describe, expect, it, vi } from "vitest"
import { accountSigners, requiredWeight, uniformWeights } from "./accounts"

const { callMock, accountIdMock } = vi.hoisted(() => ({
	callMock: vi.fn(),
	accountIdMock: vi.fn(),
}))

vi.mock("./wallet", () => ({
	horizon: { accounts: () => ({ accountId: accountIdMock }) },
}))

const holder = "GHOLDERACCOUNT"

describe("accountSigners", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		accountIdMock.mockReturnValue({ call: callMock })
	})

	it("maps the signers and thresholds of an existing account", async () => {
		callMock.mockResolvedValue({
			signers: [
				{ key: "GSIGNERONE", weight: 1, type: "ed25519_public_key" },
				{ key: "GSIGNERTWO", weight: 2, type: "ed25519_public_key" },
			],
			thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
			sequence: "4294967296",
		})

		expect(await accountSigners(holder)).toEqual({
			signers: [
				{ key: "GSIGNERONE", weight: 1 },
				{ key: "GSIGNERTWO", weight: 2 },
			],
			thresholds: { low: 1, med: 2, high: 3 },
			sequence: "4294967296",
		})
		expect(accountIdMock).toHaveBeenCalledWith(holder)
	})

	it("leaves out signers that are not ed25519 keys", async () => {
		callMock.mockResolvedValue({
			signers: [
				{ key: "GSIGNERONE", weight: 1, type: "ed25519_public_key" },
				{ key: "XHASHSIGNER", weight: 1, type: "sha256_hash" },
				{ key: "TPREAUTH", weight: 1, type: "preauth_tx" },
			],
			thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
			sequence: "1",
		})

		const result = await accountSigners(holder)

		expect(result?.signers).toEqual([{ key: "GSIGNERONE", weight: 1 }])
	})

	it("returns null when the account does not exist", async () => {
		callMock.mockRejectedValue(new Error("Not Found"))

		expect(await accountSigners(holder)).toBeNull()
	})

	it("returns null on a network error without throwing", async () => {
		callMock.mockRejectedValue(new TypeError("Failed to fetch"))

		expect(await accountSigners(holder)).toBeNull()
	})

	it("returns null for a contract address without asking Horizon", async () => {
		expect(await accountSigners("CCONTRACTADDRESS")).toBeNull()
		expect(accountIdMock).not.toHaveBeenCalled()
	})
})

describe("uniformWeights", () => {
	it("holds when every signer weighs one", () => {
		expect(
			uniformWeights([
				{ key: "GSIGNERONE", weight: 1 },
				{ key: "GSIGNERTWO", weight: 1 },
			]),
		).toBe(true)
	})

	it("fails when one signer weighs more than one", () => {
		expect(
			uniformWeights([
				{ key: "GSIGNERONE", weight: 2 },
				{ key: "GSIGNERTWO", weight: 1 },
			]),
		).toBe(false)
	})

	it("fails when every signer weighs the same but more than one", () => {
		expect(
			uniformWeights([
				{ key: "GSIGNERONE", weight: 2 },
				{ key: "GSIGNERTWO", weight: 2 },
			]),
		).toBe(false)
	})
})

describe("requiredWeight", () => {
	const withMed = (med: number) => ({
		signers: [{ key: "GKEY", weight: 1 }],
		thresholds: { low: med, med, high: med },
		sequence: "1",
	})

	it("needs one signature from a single-key account whose thresholds are zero", () => {
		expect(requiredWeight(withMed(0))).toBe(1)
	})

	it("needs the medium threshold of a multisig account", () => {
		expect(requiredWeight(withMed(3))).toBe(3)
	})
})

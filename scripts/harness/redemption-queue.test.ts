import { beforeAll, describe, expect, it } from "vitest"

import { assetsFor, price, sharesFor, units } from "./lib/amounts.js"
import {
	connect,
	oracle,
	send,
	shareToken,
	usdcBalance,
	vault,
	type Connected,
} from "./lib/clients.js"
import { waitForNotice } from "./lib/notice.js"
import { attest } from "./lib/oracle.js"
import { expectRefused } from "./lib/refused.js"

// The redemption queue on a seeded deployment (`npm run seed`): holder-2
// already holds shares and has no request in the open epoch. Every transaction
// prints `tx <label> <hash>`.
const c: Connected = connect()
const holder = c.keys["holder-2"]
const { custodian, manager, treasury, outsider } = c.keys

let decimals = 7
const cancelled = () => units(10, decimals)

const reader = vault(c, outsider)
const vaultId = c.deployment.contracts.async_vault
const shares = async (who: string) =>
	(await shareToken(c, outsider).balance({ account: who })).result
const epochStatus = async (id: bigint) =>
	(await reader.get_epoch({ epoch_id: id })).result?.status.tag
const request = async (who: string, id: bigint) =>
	(await reader.get_redeem_request({ epoch_id: id, holder: who })).result

let nav = price(1)
let epoch = 0n
let deployed = 0n
let redeemed = 0n
let owed = 0n

beforeAll(async () => {
	decimals = (await shareToken(c, outsider).decimals()).result
	// The vault prices at the oracle's standing valuation, so the run attests it
	// again rather than a price the deviation cap could refuse.
	try {
		nav = (await oracle(c, outsider).latest()).result.nav_per_share
	} catch {
		nav = price(1)
	}
})

// A claim is refused only when the liquid reserve is below that claim, and
// the reserve already holds what earlier exits are owed. So the treasury
// deploys the free reserve first, and the redemption is sized above what is
// left. Pricing an epoch releases the deposits it holds into the reserve, so
// the open epoch must hold none.
describe("a reserve that cannot cover an exit", () => {
	it("the treasury deploys the whole free reserve", async () => {
		expect((await reader.uncovered()).result).toBe(0n)
		expect(
			(await reader.cancellable_escrow()).result,
			"the open epoch holds deposits: seal and price it first",
		).toBe(0n)
		deployed = (await reader.free_reserve()).result
		expect(deployed).toBeGreaterThan(0n)
		await send(
			vault(c, treasury).deploy_to_custodian({
				caller: treasury.publicKey(),
				assets: deployed,
			}),
			"deploy_to_custodian treasury",
		)
		expect((await reader.free_reserve()).result).toBe(0n)
	})
})

describe("request and cancel", () => {
	it("the holder has the shares and no request in the open epoch", async () => {
		epoch = (await reader.current_epoch()).result
		const liquid = (await reader.liquid_reserve()).result
		redeemed = sharesFor(liquid, nav) + units(1, decimals)
		expect(
			await shares(holder.publicKey()),
			`holder-2 needs ${redeemed + cancelled()} shares: run npm run seed first`,
		).toBeGreaterThanOrEqual(redeemed + cancelled())
		expect(await request(holder.publicKey(), epoch)).toBeFalsy()
	})

	it("the holder requests a redemption in the open epoch", async () => {
		const before = await shares(holder.publicKey())
		const vaultBefore = await shares(vaultId)
		expect(
			await send(
				vault(c, holder).request_redeem({
					holder: holder.publicKey(),
					shares: cancelled(),
				}),
				"request_redeem holder-2",
			),
		).toBe(epoch)
		expect(await shares(holder.publicKey())).toBe(before - cancelled())
		expect(await shares(vaultId)).toBe(vaultBefore + cancelled())
	})

	it("the holder cancels before the epoch closes and the shares return", async () => {
		const before = await shares(holder.publicKey())
		expect(
			await send(
				vault(c, holder).cancel_redeem({
					holder: holder.publicKey(),
					epoch_id: epoch,
				}),
				"cancel_redeem holder-2",
			),
		).toBe(cancelled())
		expect(await shares(holder.publicKey())).toBe(before + cancelled())
		expect(await request(holder.publicKey(), epoch)).toBeFalsy()
	})

	it("refuses to cancel the same request twice", async () => {
		const v = vault(c, holder)
		expectRefused(
			await v.cancel_redeem({ holder: holder.publicKey(), epoch_id: epoch }),
			v,
			"RequestNotFound",
		)
	})

	it("the holder requests again, for more than the vault has left in cash", async () => {
		const before = await shares(holder.publicKey())
		expect(
			await send(
				vault(c, holder).request_redeem({
					holder: holder.publicKey(),
					shares: redeemed,
				}),
				"request_redeem holder-2 again",
			),
		).toBe(epoch)
		expect(await shares(holder.publicKey())).toBe(before - redeemed)
	})
})

describe("pricing", () => {
	it("the manager seals the epoch", async () => {
		expect(
			await send(
				vault(c, manager).close_epoch({ caller: manager.publicKey() }),
				"close_epoch manager",
			),
		).toBe(epoch)
		expect(await epochStatus(epoch)).toBe("Pending")
	})

	it("the attester prices it and an account with no role fulfils it", async () => {
		await attest(c, nav, "attest attester")
		await waitForNotice(c, reader, epoch)
		expect(
			await send(
				vault(c, outsider).fulfill_epoch({ epoch_id: epoch }),
				"fulfill_epoch outsider",
			),
		).toBe(nav)
		expect(await epochStatus(epoch)).toBe("Fulfilled")
		owed = assetsFor(redeemed, nav)
	})
})

describe("reserve short", () => {
	it("the redemption is owed but the vault cannot cover it", async () => {
		const committed = (await reader.committed()).result
		const liquid = (await reader.liquid_reserve()).result
		expect(committed).toBeGreaterThanOrEqual(owed)
		expect(liquid).toBeLessThan(owed)
		expect((await reader.uncovered()).result).toBe(committed - liquid)
		expect((await reader.uncovered()).result).toBeGreaterThan(0n)
	})

	it("the claim is refused, with nothing paid", async () => {
		const v = vault(c, holder)
		expectRefused(
			await v.claim_redeem({ holder: holder.publicKey(), epoch_id: epoch }),
			v,
			"ClaimNotCovered",
		)
	})

	it("fund returns the capital and uncovered falls to zero", async () => {
		await send(
			vault(c, custodian).fund({
				caller: custodian.publicKey(),
				assets: deployed,
			}),
			"fund custodian",
		)
		expect((await reader.uncovered()).result).toBe(0n)
	})

	it("the holder claims the cash", async () => {
		const before = await usdcBalance(c, holder.publicKey())
		const paid = await send(
			vault(c, holder).claim_redeem({
				holder: holder.publicKey(),
				epoch_id: epoch,
			}),
			"claim_redeem holder-2",
		)
		expect(paid).toBe(owed)
		expect(await usdcBalance(c, holder.publicKey())).toBe(before + paid)
	})
})

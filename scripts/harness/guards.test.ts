import { setTimeout as sleep } from "node:timers/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { pay, trustline } from "./lib/accounts.js"
import { assetsFor, price, sharesFor, units } from "./lib/amounts.js"
import {
	connect,
	identityVerifier,
	oracle,
	send,
	shareToken,
	usdcBalance,
	vault,
	type Connected,
} from "./lib/clients.js"
import { attest } from "./lib/oracle.js"
import { expectRefused } from "./lib/refused.js"

const c: Connected = connect()
const holders = [
	c.keys["holder-1"],
	c.keys["holder-2"],
	c.keys["holder-3"],
] as const
const [first, second, third] = holders
const { governance, manager, treasury, guardian, custodian, outsider, issuer } =
	c.keys

let decimals = 7
const usdc = (whole: number) => units(whole, decimals)

const reader = vault(c, outsider)
const feed = oracle(c, outsider)
const shares = async (who: string) =>
	(await shareToken(c, outsider).balance({ account: who })).result
const epochOf = async (id: bigint) =>
	(await reader.get_epoch({ epoch_id: id })).result

const closeEpoch = () =>
	send(vault(c, manager).close_epoch({ caller: manager.publicKey() }))
const fulfill = (id: bigint) =>
	send(vault(c, outsider).fulfill_epoch({ epoch_id: id }))

beforeAll(async () => {
	decimals = (await shareToken(c, outsider).decimals()).result
	const verifier = identityVerifier(c, governance)
	for (const holder of [...holders, custodian]) {
		await trustline(c.net, c.server, holder, c.asset)
	}
	for (const holder of holders) {
		await pay(c.net, c.server, issuer, holder.publicKey(), c.asset, "1000")
		await send(
			verifier.allow({
				account: holder.publicKey(),
				allowed: true,
				caller: governance.publicKey(),
			}),
		)
	}
	await send(
		vault(c, governance).set_custodian({
			custodian: custodian.publicKey(),
			caller: governance.publicKey(),
		}),
	)
})

describe("an account with no role", () => {
	const who = outsider.publicKey()

	it("cannot close the epoch", async () => {
		const v = vault(c, outsider)
		expectRefused(await v.close_epoch({ caller: who }), v, "Unauthorized")
	})

	it("cannot deploy the reserve", async () => {
		const v = vault(c, outsider)
		expectRefused(
			await v.deploy_to_custodian({ caller: who, assets: 1n }),
			v,
			"Unauthorized",
		)
	})

	it("cannot set the custodian", async () => {
		await expect(
			send(vault(c, outsider).set_custodian({ custodian: who, caller: who })),
		).rejects.toThrow(/signatures/)
	})

	it("cannot attest a price", async () => {
		const o = oracle(c, outsider)
		const now = BigInt(Math.floor(Date.now() / 1000))
		expectRefused(
			await o.attest({
				report: {
					nav_per_share: price(2),
					expires_at: now + 600n,
					timestamp: now,
				},
				caller: who,
			}),
			o,
			"Unauthorized",
		)
	})

	it("cannot raise the ripcord", async () => {
		const o = oracle(c, outsider)
		expectRefused(await o.raise_ripcord({ caller: who }), o, "Unauthorized")
	})

	it("cannot pause the vault", async () => {
		const v = vault(c, outsider)
		expectRefused(await v.pause({ caller: who }), v, "Unauthorized")
	})

	it("cannot unpause the vault", async () => {
		await send(vault(c, guardian).pause({ caller: guardian.publicKey() }))
		await expect(
			send(vault(c, outsider).unpause({ caller: who })),
		).rejects.toThrow(/signatures/)
		await send(vault(c, governance).unpause({ caller: governance.publicKey() }))
	})

	it("cannot set the ripcord", async () => {
		await expect(
			send(oracle(c, outsider).set_ripcord({ paused: true, caller: who })),
		).rejects.toThrow(/signatures/)
	})

	it("cannot clear the latest report", async () => {
		await send(
			oracle(c, guardian).raise_ripcord({ caller: guardian.publicKey() }),
		)
		await expect(
			send(oracle(c, outsider).clear_latest({ caller: who })),
		).rejects.toThrow(/signatures/)
		await send(
			oracle(c, governance).set_ripcord({
				paused: false,
				caller: governance.publicKey(),
			}),
		)
	})

	it("cannot change the feed config", async () => {
		const config = (await feed.config()).result
		await expect(
			send(oracle(c, outsider).set_config({ config })),
		).rejects.toThrow(/signatures/)
	})
})

describe("invalid amounts and duplicate requests in an epoch", () => {
	it("rejects zero deposit amount", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.request_deposit({ from: first.publicKey(), amount: 0n }),
			v,
			"InvalidAmount",
		)
	})

	it("rejects zero redeem shares", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.request_redeem({ from: first.publicKey(), shares: 0n }),
			v,
			"InvalidAmount",
		)
	})

	it("rejects a second request from the same account in one epoch", async () => {
		const v = vault(c, first)
		const epoch = await send(
			v.request_deposit({ from: first.publicKey(), amount: usdc(10) }),
		)
		expectRefused(
			await v.request_deposit({ from: first.publicKey(), amount: usdc(10) }),
			v,
			"RequestOutstanding",
		)
		await send(v.cancel_deposit({ from: first.publicKey(), epoch_id: epoch }))
	})
})

const firstPrice = price(2)
const secondPrice = (price(2) * 105n) / 100n
let epochA = 0n
let epochB = 0n

describe("two epochs pending at once", () => {
	it("both read Pending", async () => {
		epochA = await send(
			vault(c, first).request_deposit({
				from: first.publicKey(),
				amount: usdc(100),
			}),
		)
		expect(await closeEpoch()).toBe(epochA)
		epochB = await send(
			vault(c, second).request_deposit({
				from: second.publicKey(),
				amount: usdc(100),
			}),
		)
		expect(await closeEpoch()).toBe(epochB)
		expect((await epochOf(epochA))?.status.tag).toBe("Pending")
		expect((await epochOf(epochB))?.status.tag).toBe("Pending")
		expectRefused(
			await vault(c, first).claim_deposit({
				caller: first.publicKey(),
				epoch_id: epochA,
			}),
			vault(c, first),
			"EpochNotFulfilled",
		)
	})

	it("each keeps the price it was fulfilled at", async () => {
		await attest(c, firstPrice)
		expect(await fulfill(epochA)).toBe(firstPrice)
		await attest(c, secondPrice)
		expect(await fulfill(epochB)).toBe(secondPrice)
		expect((await epochOf(epochA))?.share_price).toBe(firstPrice)
		expect((await epochOf(epochB))?.share_price).toBe(secondPrice)
	})

	it("claims mint at each epoch's own price", async () => {
		expect(
			await send(
				vault(c, first).claim_deposit({
					caller: first.publicKey(),
					epoch_id: epochA,
				}),
			),
		).toBe(sharesFor(usdc(100), firstPrice))
		expect(
			await send(
				vault(c, second).claim_deposit({
					caller: second.publicKey(),
					epoch_id: epochB,
				}),
			),
		).toBe(sharesFor(usdc(100), secondPrice))
		expectRefused(
			await vault(c, first).claim_deposit({
				caller: first.publicKey(),
				epoch_id: epochA,
			}),
			vault(c, first),
			"AlreadyClaimed",
		)
		expectRefused(
			await vault(c, outsider).claim_deposit({
				caller: outsider.publicKey(),
				epoch_id: epochA,
			}),
			vault(c, outsider),
			"RequestNotFound",
		)
	})
})

describe("a small covered claim pays while a larger one waits", () => {
	let epoch = 0n
	let small = 0n
	let large = 0n

	it("two exits of different sizes are priced with most of the reserve deployed", async () => {
		small = sharesFor(usdc(10), secondPrice)
		large = await shares(second.publicKey())
		await send(
			vault(c, first).request_redeem({
				from: first.publicKey(),
				shares: small,
			}),
		)
		epoch = await send(
			vault(c, second).request_redeem({
				from: second.publicKey(),
				shares: large,
			}),
		)
		await send(
			vault(c, treasury).deploy_to_custodian({
				caller: treasury.publicKey(),
				assets: usdc(150),
			}),
		)
		expect(await closeEpoch()).toBe(epoch)
		await attest(c, secondPrice)
		await fulfill(epoch)
		const liquid = (await reader.liquid_reserve()).result
		expect(liquid).toBeGreaterThanOrEqual(assetsFor(small, secondPrice))
		expect(liquid).toBeLessThan(assetsFor(large, secondPrice))
	})

	it("the small claim pays", async () => {
		const before = await usdcBalance(c, first.publicKey())
		const paid = await send(
			vault(c, first).claim_redeem({
				caller: first.publicKey(),
				epoch_id: epoch,
			}),
		)
		expect(paid).toBe(assetsFor(small, secondPrice))
		expect(await usdcBalance(c, first.publicKey())).toBe(before + paid)
	})

	it("the large claim waits", async () => {
		const v = vault(c, second)
		expectRefused(
			await v.claim_redeem({ caller: second.publicKey(), epoch_id: epoch }),
			v,
			"ClaimNotCovered",
		)
		expect((await reader.uncovered()).result).toBeGreaterThan(0n)
	})

	it("pays once the capital returns", async () => {
		await send(
			vault(c, custodian).fund({
				from: custodian.publicKey(),
				assets: usdc(150),
			}),
		)
		const paid = await send(
			vault(c, second).claim_redeem({
				caller: second.publicKey(),
				epoch_id: epoch,
			}),
		)
		expect(paid).toBe(assetsFor(large, secondPrice))
		expect((await reader.uncovered()).result).toBe(0n)
		expectRefused(
			await vault(c, second).claim_redeem({
				caller: second.publicKey(),
				epoch_id: epoch,
			}),
			vault(c, second),
			"AlreadyClaimed",
		)
	})
})

describe("a deposit too small to mint a share", () => {
	let epoch = 0n

	it("is refunded at claim", async () => {
		const before = await usdcBalance(c, third.publicKey())
		epoch = await send(
			vault(c, third).request_deposit({ from: third.publicKey(), amount: 1n }),
		)
		expect(await closeEpoch()).toBe(epoch)
		await attest(c, secondPrice)
		await fulfill(epoch)
		expect(
			await send(
				vault(c, third).claim_deposit({
					caller: third.publicKey(),
					epoch_id: epoch,
				}),
			),
		).toBe(0n)
		expect(await usdcBalance(c, third.publicKey())).toBe(before)
		expect(await shares(third.publicKey())).toBe(0n)
	})
})

describe("a de-listed holder", () => {
	const from = first.publicKey()
	let epoch = 0n
	let redeeming = 0n

	it("cannot cancel a redemption back to shares", async () => {
		redeeming = sharesFor(usdc(10), secondPrice)
		epoch = await send(
			vault(c, first).request_redeem({ from, shares: redeeming }),
		)
		await send(
			identityVerifier(c, governance).allow({
				account: first.publicKey(),
				allowed: false,
				caller: governance.publicKey(),
			}),
		)
		expectRefused(
			await vault(c, first).cancel_redeem({ from, epoch_id: epoch }),
			shareToken(c, outsider),
			"IdentityVerificationFailed",
		)
	})

	it("still claims the priced exit in cash", async () => {
		expect(await closeEpoch()).toBe(epoch)
		await attest(c, secondPrice)
		await fulfill(epoch)
		const before = await usdcBalance(c, first.publicKey())
		const paid = await send(
			vault(c, first).claim_redeem({
				caller: first.publicKey(),
				epoch_id: epoch,
			}),
		)
		expect(paid).toBe(assetsFor(redeeming, secondPrice))
		expect(await usdcBalance(c, first.publicKey())).toBe(before + paid)
	})

	it("is allowlisted again", async () => {
		await send(
			identityVerifier(c, governance).allow({
				account: first.publicKey(),
				allowed: true,
				caller: governance.publicKey(),
			}),
		)
		expect(
			(
				await identityVerifier(c, outsider).is_allowed({
					account: first.publicKey(),
				})
			).result,
		).toBe(true)
	})
})

describe("a sealed epoch while the feed is down", () => {
	let epoch = 0n
	let redeeming = 0n

	it("cannot be cancelled while the feed can price it", async () => {
		redeeming = await shares(first.publicKey())
		await send(
			vault(c, first).request_deposit({
				from: first.publicKey(),
				amount: usdc(100),
			}),
		)
		epoch = await send(
			vault(c, first).request_redeem({
				from: first.publicKey(),
				shares: redeeming,
			}),
		)
		expect(await closeEpoch()).toBe(epoch)
		await attest(c, secondPrice)
		const v = vault(c, first)
		expectRefused(
			await v.cancel_deposit({ from: first.publicKey(), epoch_id: epoch }),
			v,
			"PriceAvailable",
		)
		expectRefused(
			await v.cancel_redeem({ from: first.publicKey(), epoch_id: epoch }),
			v,
			"PriceAvailable",
		)
	})

	it("the guardian raises the ripcord and pricing is refused", async () => {
		await send(
			oracle(c, guardian).raise_ripcord({ caller: guardian.publicKey() }),
		)
		expect((await feed.state()).result.tag).toBe("Paused")
		expectRefused(
			await vault(c, outsider).fulfill_epoch({ epoch_id: epoch }),
			reader,
			"FeedNotValid",
		)
	})

	it("the deposit can now be cancelled and the asset returns", async () => {
		const before = await usdcBalance(c, first.publicKey())
		expect(
			await send(
				vault(c, first).cancel_deposit({
					from: first.publicKey(),
					epoch_id: epoch,
				}),
			),
		).toBe(usdc(100))
		expect(await usdcBalance(c, first.publicKey())).toBe(before + usdc(100))
	})

	it("the redemption can now be cancelled and the shares return", async () => {
		expect(
			await send(
				vault(c, first).cancel_redeem({
					from: first.publicKey(),
					epoch_id: epoch,
				}),
			),
		).toBe(redeeming)
		expect(await shares(first.publicKey())).toBe(redeeming)
	})

	it("a second cancel finds no request", async () => {
		expectRefused(
			await vault(c, first).cancel_redeem({
				from: first.publicKey(),
				epoch_id: epoch,
			}),
			reader,
			"RequestNotFound",
		)
	})
})

describe("the notice period and valuation age rules", () => {
	const noticeSecs = 10n
	let epochA = 0n
	let epochB = 0n

	beforeAll(async () => {
		await send(
			oracle(c, governance).set_ripcord({
				paused: false,
				caller: governance.publicKey(),
			}),
		)
		await send(
			vault(c, governance).set_notice({
				secs: noticeSecs,
				caller: governance.publicKey(),
			}),
		)
	})

	afterAll(async () => {
		await send(
			vault(c, governance).set_notice({
				secs: 0n,
				caller: governance.publicKey(),
			}),
		)
	})

	it("records priceable_at at close and holds it through the notice", async () => {
		await send(
			vault(c, first).request_deposit({
				from: first.publicKey(),
				amount: usdc(100),
			}),
		)
		epochA = await closeEpoch()
		const info = await epochOf(epochA)
		expect(info?.closed_at).toBeGreaterThan(0n)
		expect(info?.priceable_at).toBe(info!.closed_at + noticeSecs)

		expectRefused(
			await vault(c, outsider).fulfill_epoch({ epoch_id: epochA }),
			reader,
			"NoticeNotElapsed",
		)
	})

	it("refuses pricing after the notice when the valuation is before the close", async () => {
		const info = await epochOf(epochA)
		const now = BigInt(Math.floor(Date.now() / 1000))
		const waitMs = Math.max(0, Number(info!.priceable_at - now + 2n) * 1000)
		if (waitMs > 0) {
			await sleep(waitMs)
		}
		expectRefused(
			await vault(c, outsider).fulfill_epoch({ epoch_id: epochA }),
			reader,
			"AttestationBeforeClose",
		)
	})

	it("prices once a valuation lands after the close", async () => {
		await attest(c, secondPrice)
		expect(await fulfill(epochA)).toBe(secondPrice)
		expect((await epochOf(epochA))?.share_price).toBe(secondPrice)
	})

	it("refuses cancellation while the notice is running once price is readable", async () => {
		await send(
			vault(c, first).request_deposit({
				from: first.publicKey(),
				amount: usdc(100),
			}),
		)
		epochB = await closeEpoch()
		await attest(c, secondPrice)
		const v = vault(c, first)
		expectRefused(
			await v.cancel_deposit({ from: first.publicKey(), epoch_id: epochB }),
			v,
			"PriceAvailable",
		)
		expectRefused(
			await vault(c, outsider).fulfill_epoch({ epoch_id: epochB }),
			reader,
			"NoticeNotElapsed",
		)
		const info = await epochOf(epochB)
		const now = BigInt(Math.floor(Date.now() / 1000))
		const waitMs = Math.max(0, Number(info!.priceable_at - now + 2n) * 1000)
		if (waitMs > 0) {
			await sleep(waitMs)
		}
		expect(await fulfill(epochB)).toBe(secondPrice)
	})
})

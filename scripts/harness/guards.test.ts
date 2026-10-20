import { setTimeout as sleep } from "node:timers/promises"
import { beforeAll, describe, expect, it } from "vitest"

import { pay, trustline } from "./lib/accounts.js"
import { assetsFor, price, sharesFor, units } from "./lib/amounts.js"
import {
	complianceContract,
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
const {
	governance,
	compliance,
	manager,
	treasury,
	guardian,
	custodian,
	outsider,
	issuer,
} = c.keys

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
	const verifier = identityVerifier(c, compliance)
	for (const holder of [...holders, custodian]) {
		await trustline(c.net, c.server, holder, c.asset)
	}
	for (const holder of holders) {
		await pay(c.net, c.server, issuer, holder.publicKey(), c.asset, "1000")
		await send(
			verifier.allow({
				account: holder.publicKey(),
				allowed: true,
			}),
		)
	}
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

	it("cannot change the custodian", async () => {
		await expect(
			send(
				vault(c, outsider).propose_change({
					change: { tag: "Custodian", values: [who] },
					caller: who,
				}),
			),
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

	it("cannot pause the NAV", async () => {
		const o = oracle(c, outsider)
		expectRefused(await o.pause_nav({ caller: who }), o, "Unauthorized")
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

	it("cannot set the NAV pause", async () => {
		await expect(
			send(oracle(c, outsider).set_nav_paused({ paused: true, caller: who })),
		).rejects.toThrow(/signatures/)
	})

	it("cannot clear the latest report", async () => {
		await send(oracle(c, guardian).pause_nav({ caller: guardian.publicKey() }))
		await expect(
			send(oracle(c, outsider).clear_latest({ caller: who })),
		).rejects.toThrow(/signatures/)
		await send(
			oracle(c, governance).set_nav_paused({
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

describe("the compliance authority's reach", () => {
	const holder = () => first.publicKey()

	it("governance cannot write the allowlist", async () => {
		await expect(
			send(
				identityVerifier(c, governance).allow({
					account: outsider.publicKey(),
					allowed: true,
				}),
			),
		).rejects.toThrow(/signatures/)
	})

	it("governance and the vault manager cannot freeze a holder", async () => {
		for (const who of [governance, manager]) {
			const token = shareToken(c, who)
			expectRefused(
				await token.set_address_frozen({
					user_address: holder(),
					freeze: true,
					operator: who.publicKey(),
				}),
				token,
				"Unauthorized",
			)
		}
	})

	it("compliance cannot mint shares", async () => {
		const token = shareToken(c, compliance)
		expectRefused(
			await token.mint({
				to: compliance.publicKey(),
				amount: 1n,
				operator: compliance.publicKey(),
			}),
			token,
			"Unauthorized",
		)
	})

	it("compliance cannot propose a new identity verifier", async () => {
		await expect(
			send(
				shareToken(c, compliance).propose_change({
					change: {
						tag: "IdentityVerifier",
						values: [c.deployment.contracts.compliance],
					},
					caller: compliance.publicKey(),
				}),
			),
		).rejects.toThrow(/signatures/)
	})
})

describe("the share token after setup", () => {
	const caller = () => governance.publicKey()
	const verifier = () => c.deployment.contracts.identity_verifier

	it("refuses an instant verifier swap, even from governance", async () => {
		const token = shareToken(c, governance)
		expectRefused(
			await token.set_identity_verifier({
				identity_verifier: verifier(),
				operator: caller(),
			}),
			token,
			"UseTimelock",
		)
	})

	it("queues the swap behind the vault's delay", async () => {
		const token = shareToken(c, governance)
		const id = await send(
			token.propose_change({
				change: { tag: "IdentityVerifier", values: [verifier()] },
				caller: caller(),
			}),
		)
		expectRefused(
			await token.apply_change({ id, caller: caller() }),
			token,
			"ChangeNotReady",
		)
		await send(token.cancel_change({ id, caller: caller() }))
		expect((await token.pending_changes()).result).toEqual([])
	})
})

describe("the oracle after setup", () => {
	const caller = () => governance.publicKey()

	it("governance cannot loosen the feed config at once", async () => {
		const config = (await feed.config()).result
		const o = oracle(c, governance)
		expectRefused(
			await o.set_config({
				config: {
					...config,
					freshness_duration: config.freshness_duration + 60n,
				},
			}),
			o,
			"UseTimelock",
		)
	})

	it("governance cannot tighten the fall cap at once either", async () => {
		const config = (await feed.config()).result
		const o = oracle(c, governance)
		expectRefused(
			await o.set_config({
				config: { ...config, max_down_bps: config.max_down_bps - 1 },
			}),
			o,
			"UseTimelock",
		)
	})

	it("queues a config change behind the vault's delay", async () => {
		const config = (await feed.config()).result
		const o = oracle(c, governance)
		const id = await send(
			o.propose_change({
				change: {
					tag: "Config",
					values: [{ ...config, max_down_bps: config.max_down_bps - 1 }],
				},
				caller: caller(),
			}),
		)
		expectRefused(
			await o.apply_change({ id, caller: caller() }),
			o,
			"ChangeNotReady",
		)
		await send(o.cancel_change({ id, caller: caller() }))
		expect((await o.pending_changes()).result).toEqual([])
	})
})

describe("the compliance contract after setup", () => {
	const caller = () => governance.publicKey()
	const canCreate = { tag: "CanCreate", values: undefined } as const

	it("governance cannot add a module at once", async () => {
		const rules = complianceContract(c, governance)
		expectRefused(
			await rules.add_module_to({
				hook: canCreate,
				module: outsider.publicKey(),
				operator: caller(),
			}),
			rules,
			"UseTimelock",
		)
	})

	it("queues a module behind the vault's delay", async () => {
		const rules = complianceContract(c, governance)
		const id = await send(
			rules.propose_change({
				change: { tag: "AddModule", values: [canCreate, outsider.publicKey()] },
				caller: caller(),
			}),
		)
		expectRefused(
			await rules.apply_change({ id, caller: caller() }),
			rules,
			"ChangeNotReady",
		)
		await send(rules.cancel_change({ id, caller: caller() }))
		expect((await rules.pending_changes()).result).toEqual([])
	})
})

describe("the vault after setup", () => {
	const caller = () => governance.publicKey()

	it("governance cannot change the custodian at once", async () => {
		const v = vault(c, governance)
		expectRefused(
			await v.set_custodian({
				custodian: outsider.publicKey(),
				caller: caller(),
			}),
			v,
			"UseTimelock",
		)
		expect((await reader.custodian()).result).toBe(custodian.publicKey())
	})

	it("queues a custodian change behind its delay", async () => {
		const v = vault(c, governance)
		const id = await send(
			v.propose_change({
				change: { tag: "Custodian", values: [outsider.publicKey()] },
				caller: caller(),
			}),
		)
		expectRefused(
			await v.apply_change({ id, caller: caller() }),
			v,
			"ChangeNotReady",
		)
		await send(v.cancel_change({ id, caller: caller() }))
		expect((await v.pending_changes()).result).toEqual([])
	})
})

describe("invalid amounts and duplicate requests in an epoch", () => {
	it("rejects zero deposit amount", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.request_deposit({ holder: first.publicKey(), amount: 0n }),
			v,
			"InvalidAmount",
		)
	})

	it("rejects zero redeem shares", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.request_redeem({ holder: first.publicKey(), shares: 0n }),
			v,
			"InvalidAmount",
		)
	})

	it("rejects a second request from the same account in one epoch", async () => {
		const v = vault(c, first)
		const epoch = await send(
			v.request_deposit({ holder: first.publicKey(), amount: usdc(10) }),
		)
		expectRefused(
			await v.request_deposit({ holder: first.publicKey(), amount: usdc(10) }),
			v,
			"RequestOutstanding",
		)
		await send(v.cancel_deposit({ holder: first.publicKey(), epoch_id: epoch }))
	})
})

describe("who may subscribe", () => {
	it("refuses a deposit request from an address that is not allowlisted", async () => {
		const v = vault(c, outsider)
		expectRefused(
			await v.request_deposit({
				holder: outsider.publicKey(),
				amount: usdc(10),
			}),
			v,
			"NotAllowlisted",
		)
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
				holder: first.publicKey(),
				amount: usdc(100),
			}),
		)
		expect(await closeEpoch()).toBe(epochA)
		epochB = await send(
			vault(c, second).request_deposit({
				holder: second.publicKey(),
				amount: usdc(100),
			}),
		)
		expect(await closeEpoch()).toBe(epochB)
		expect((await epochOf(epochA))?.status.tag).toBe("Pending")
		expect((await epochOf(epochB))?.status.tag).toBe("Pending")
		expectRefused(
			await vault(c, first).claim_deposit({
				holder: first.publicKey(),
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
					holder: first.publicKey(),
					epoch_id: epochA,
				}),
			),
		).toBe(sharesFor(usdc(100), firstPrice))
		expect(
			await send(
				vault(c, second).claim_deposit({
					holder: second.publicKey(),
					epoch_id: epochB,
				}),
			),
		).toBe(sharesFor(usdc(100), secondPrice))
		expectRefused(
			await vault(c, first).claim_deposit({
				holder: first.publicKey(),
				epoch_id: epochA,
			}),
			vault(c, first),
			"AlreadyClaimed",
		)
		expectRefused(
			await vault(c, outsider).claim_deposit({
				holder: outsider.publicKey(),
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
				holder: first.publicKey(),
				shares: small,
			}),
		)
		epoch = await send(
			vault(c, second).request_redeem({
				holder: second.publicKey(),
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
				holder: first.publicKey(),
				epoch_id: epoch,
			}),
		)
		expect(paid).toBe(assetsFor(small, secondPrice))
		expect(await usdcBalance(c, first.publicKey())).toBe(before + paid)
	})

	it("the large claim waits", async () => {
		const v = vault(c, second)
		expectRefused(
			await v.claim_redeem({ holder: second.publicKey(), epoch_id: epoch }),
			v,
			"ClaimNotCovered",
		)
		expect((await reader.uncovered()).result).toBeGreaterThan(0n)
	})

	it("pays once the capital returns", async () => {
		await send(
			vault(c, custodian).fund({
				caller: custodian.publicKey(),
				assets: usdc(150),
			}),
		)
		const paid = await send(
			vault(c, second).claim_redeem({
				holder: second.publicKey(),
				epoch_id: epoch,
			}),
		)
		expect(paid).toBe(assetsFor(large, secondPrice))
		expect((await reader.uncovered()).result).toBe(0n)
		expectRefused(
			await vault(c, second).claim_redeem({
				holder: second.publicKey(),
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
			vault(c, third).request_deposit({
				holder: third.publicKey(),
				amount: 1n,
			}),
		)
		expect(await closeEpoch()).toBe(epoch)
		await attest(c, secondPrice)
		await fulfill(epoch)
		expect(
			await send(
				vault(c, third).claim_deposit({
					holder: third.publicKey(),
					epoch_id: epoch,
				}),
			),
		).toBe(0n)
		expect(await usdcBalance(c, third.publicKey())).toBe(before)
		expect(await shares(third.publicKey())).toBe(0n)
	})
})

describe("a de-listed holder", () => {
	const holder = first.publicKey()
	let epoch = 0n
	let redeeming = 0n

	it("cannot cancel a redemption back to shares", async () => {
		redeeming = sharesFor(usdc(10), secondPrice)
		epoch = await send(
			vault(c, first).request_redeem({ holder, shares: redeeming }),
		)
		await send(
			identityVerifier(c, compliance).allow({
				account: first.publicKey(),
				allowed: false,
			}),
		)
		expectRefused(
			await vault(c, first).cancel_redeem({ holder, epoch_id: epoch }),
			vault(c, first),
			"NotAllowlisted",
		)
	})

	it("still claims the priced exit in cash", async () => {
		expect(await closeEpoch()).toBe(epoch)
		await attest(c, secondPrice)
		await fulfill(epoch)
		const before = await usdcBalance(c, first.publicKey())
		const paid = await send(
			vault(c, first).claim_redeem({
				holder: first.publicKey(),
				epoch_id: epoch,
			}),
		)
		expect(paid).toBe(assetsFor(redeeming, secondPrice))
		expect(await usdcBalance(c, first.publicKey())).toBe(before + paid)
	})

	it("is allowlisted again", async () => {
		await send(
			identityVerifier(c, compliance).allow({
				account: first.publicKey(),
				allowed: true,
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
				holder: first.publicKey(),
				amount: usdc(100),
			}),
		)
		epoch = await send(
			vault(c, first).request_redeem({
				holder: first.publicKey(),
				shares: redeeming,
			}),
		)
		expect(await closeEpoch()).toBe(epoch)
		await attest(c, secondPrice)
		const v = vault(c, first)
		expectRefused(
			await v.cancel_deposit({ holder: first.publicKey(), epoch_id: epoch }),
			v,
			"PriceAvailable",
		)
		expectRefused(
			await v.cancel_redeem({ holder: first.publicKey(), epoch_id: epoch }),
			v,
			"PriceAvailable",
		)
	})

	it("the guardian pauses the NAV and pricing is refused", async () => {
		await send(oracle(c, guardian).pause_nav({ caller: guardian.publicKey() }))
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
					holder: first.publicKey(),
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
					holder: first.publicKey(),
					epoch_id: epoch,
				}),
			),
		).toBe(redeeming)
		expect(await shares(first.publicKey())).toBe(redeeming)
	})

	it("a second cancel finds no request", async () => {
		expectRefused(
			await vault(c, first).cancel_redeem({
				holder: first.publicKey(),
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
			oracle(c, governance).set_nav_paused({
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

	it("records priceable_at at close and holds it through the notice", async () => {
		await send(
			vault(c, first).request_deposit({
				holder: first.publicKey(),
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
				holder: first.publicKey(),
				amount: usdc(100),
			}),
		)
		epochB = await closeEpoch()
		await attest(c, secondPrice)
		const v = vault(c, first)
		expectRefused(
			await v.cancel_deposit({ holder: first.publicKey(), epoch_id: epochB }),
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

	it("governance cannot lower the notice at once", async () => {
		const v = vault(c, governance)
		expectRefused(
			await v.set_notice({ secs: 0n, caller: governance.publicKey() }),
			v,
			"UseTimelock",
		)
		expect((await reader.notice()).result).toBe(noticeSecs)
	})
})

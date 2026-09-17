import { beforeAll, describe, expect, it } from "vitest"

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
const [first, second, canceller] = holders
const { governance, custodian, outsider, issuer, manager, treasury } = c.keys

let decimals = 7
const usdc = (whole: number) => units(whole, decimals)
const each = () => usdc(100)

const reader = vault(c, outsider)
const vaultId = c.deployment.contracts.async_vault
const shares = async (who: string) =>
	(await shareToken(c, outsider).balance({ account: who })).result
const epochStatus = async (id: bigint) =>
	(await reader.get_epoch({ epoch_id: id })).result?.status.tag

beforeAll(async () => {
	decimals = (await shareToken(c, outsider).decimals()).result
})

describe("setup", () => {
	it("each holder exists on the network", async () => {
		for (const holder of [...holders, custodian]) {
			await expect(
				c.server.getAccount(holder.publicKey()),
			).resolves.toBeDefined()
		}
	})

	it("establishes the trustline", async () => {
		for (const holder of [...holders, custodian]) {
			await trustline(c.net, c.server, holder, c.asset)
		}
		for (const holder of [...holders, custodian]) {
			expect(await usdcBalance(c, holder.publicKey())).toBe(0n)
		}
	})

	it("pays each holder test balance", async () => {
		for (const holder of holders) {
			await pay(c.net, c.server, issuer, holder.publicKey(), c.asset, "1000")
			expect(await usdcBalance(c, holder.publicKey())).toBe(usdc(1000))
		}
	})

	it("allowlists each holder", async () => {
		const verifier = identityVerifier(c, governance)
		for (const holder of holders) {
			await send(
				verifier.allow({
					account: holder.publicKey(),
					allowed: true,
					caller: governance.publicKey(),
				}),
			)
			expect(
				(await verifier.is_allowed({ account: holder.publicKey() })).result,
			).toBe(true)
		}
	})
})

let subscriptionEpoch = 0n

describe("subscription", () => {
	let escrowBefore = 0n
	let freeBefore = 0n

	it("two holders subscribe in the same epoch and see their escrow", async () => {
		subscriptionEpoch = (await reader.current_epoch()).result
		escrowBefore = (await reader.cancellable_escrow()).result
		freeBefore = (await reader.free_reserve()).result
		for (const holder of [first, second]) {
			const epoch = await send(
				vault(c, holder).request_deposit({
					from: holder.publicKey(),
					amount: each(),
				}),
			)
			expect(epoch).toBe(subscriptionEpoch)
			const request = (
				await reader.get_deposit_request({
					epoch_id: subscriptionEpoch,
					controller: holder.publicKey(),
				})
			).result
			expect(request?.amount).toBe(each())
		}
	})

	it("cancellable escrow is their sum and the free reserve excludes it", async () => {
		expect((await reader.cancellable_escrow()).result).toBe(
			escrowBefore + each() * 2n,
		)
		expect((await reader.free_reserve()).result).toBe(freeBefore)
	})

	it("refuses to cancel in an epoch that does not exist", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.cancel_deposit({
				from: first.publicKey(),
				epoch_id: subscriptionEpoch + 1000n,
			}),
			v,
			"EpochNotFound",
		)
	})

	it("a third holder cancels while the epoch is open and the asset returns", async () => {
		const before = await usdcBalance(c, canceller.publicKey())
		const v = vault(c, canceller)
		await send(
			v.request_deposit({ from: canceller.publicKey(), amount: each() }),
		)
		expect(await usdcBalance(c, canceller.publicKey())).toBe(before - each())
		const returned = await send(
			v.cancel_deposit({
				from: canceller.publicKey(),
				epoch_id: subscriptionEpoch,
			}),
		)
		expect(returned).toBe(each())
		expect(await usdcBalance(c, canceller.publicKey())).toBe(before)
		expect((await reader.cancellable_escrow()).result).toBe(
			escrowBefore + each() * 2n,
		)
	})
})

const nav = price(2)
let redemptionEpoch = 0n
const redeemed = new Map<string, bigint>()

describe("pricing", () => {
	let escrowBefore = 0n
	let freeBefore = 0n

	it("the manager closes the epoch", async () => {
		escrowBefore = (await reader.cancellable_escrow()).result
		freeBefore = (await reader.free_reserve()).result
		const closed = await send(
			vault(c, manager).close_epoch({ caller: manager.publicKey() }),
		)
		expect(closed).toBe(subscriptionEpoch)
		expect(await epochStatus(subscriptionEpoch)).toBe("Pending")
		expect((await reader.current_epoch()).result).toBe(subscriptionEpoch + 1n)
	})

	it("the attester publishes a report", async () => {
		await attest(c, nav)
		const latest = (await oracle(c, outsider).latest()).result
		expect(latest.nav_per_share).toBe(nav)
		expect(latest.expires_at - latest.timestamp).toBe(
			BigInt(c.net.oracle.freshness_duration),
		)
	})

	it("an account with no role prices the epoch", async () => {
		const priced = await send(
			vault(c, outsider).fulfill_epoch({ epoch_id: subscriptionEpoch }),
		)
		expect(priced).toBe(nav)
		const info = (await reader.get_epoch({ epoch_id: subscriptionEpoch }))
			.result
		expect(info?.status.tag).toBe("Fulfilled")
		expect(info?.share_price).toBe(nav)
	})

	it("pricing releases the escrow into the free reserve", async () => {
		expect((await reader.cancellable_escrow()).result).toBe(
			escrowBefore - each() * 2n,
		)
		expect((await reader.free_reserve()).result).toBe(freeBefore + each() * 2n)
	})

	it("each holder claims and the shares sum to the epoch total", async () => {
		let minted = 0n
		for (const holder of [first, second]) {
			const before = await shares(holder.publicKey())
			const got = await send(
				vault(c, holder).claim_deposit({
					caller: holder.publicKey(),
					epoch_id: subscriptionEpoch,
				}),
			)
			expect(got).toBe(sharesFor(each(), nav))
			expect(await shares(holder.publicKey())).toBe(before + got)
			minted += got
		}
		expect(minted).toBe(sharesFor(each() * 2n, nav))
	})

	it("refuses a second claim on the same epoch", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.claim_deposit({
				caller: first.publicKey(),
				epoch_id: subscriptionEpoch,
			}),
			v,
			"AlreadyClaimed",
		)
	})
})

describe("redemption", () => {
	it("both holders redeem in the same epoch and the shares move into the vault", async () => {
		redemptionEpoch = (await reader.current_epoch()).result
		const vaultBefore = await shares(vaultId)
		for (const holder of [first, second]) {
			const held = await shares(holder.publicKey())
			const epoch = await send(
				vault(c, holder).request_redeem({
					from: holder.publicKey(),
					shares: held,
				}),
			)
			expect(epoch).toBe(redemptionEpoch)
			expect(await shares(holder.publicKey())).toBe(0n)
			redeemed.set(holder.publicKey(), held)
		}
		const total = [...redeemed.values()].reduce((a, b) => a + b, 0n)
		expect(await shares(vaultId)).toBe(vaultBefore + total)
	})

	it("refuses a second exit request in one epoch", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.request_redeem({ from: first.publicKey(), shares: 1n }),
			v,
			"RequestOutstanding",
		)
	})

	it("refuses to pay a claim before the epoch is priced", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.claim_redeem({
				caller: first.publicKey(),
				epoch_id: redemptionEpoch,
			}),
			v,
			"EpochNotFulfilled",
		)
	})
})

describe("treasury", () => {
	const deployed = () => usdc(150)
	let owed = 0n

	it("governance sets the custodian", async () => {
		await send(
			vault(c, governance).set_custodian({
				custodian: custodian.publicKey(),
				caller: governance.publicKey(),
			}),
		)
		expect((await reader.custodian()).result).toBe(custodian.publicKey())
	})

	it("the treasury deploys part of the reserve and the free reserve falls by exactly that amount", async () => {
		const freeBefore = (await reader.free_reserve()).result
		const custodianBefore = await usdcBalance(c, custodian.publicKey())
		await send(
			vault(c, treasury).deploy_to_custodian({
				caller: treasury.publicKey(),
				assets: deployed(),
			}),
		)
		expect((await reader.free_reserve()).result).toBe(freeBefore - deployed())
		expect(await usdcBalance(c, custodian.publicKey())).toBe(
			custodianBefore + deployed(),
		)
	})

	it("the exits are priced while the reserve is deployed", async () => {
		await send(vault(c, manager).close_epoch({ caller: manager.publicKey() }))
		await attest(c, nav)
		await send(vault(c, outsider).fulfill_epoch({ epoch_id: redemptionEpoch }))
		expect(await epochStatus(redemptionEpoch)).toBe("Fulfilled")
		const total = [...redeemed.values()].reduce((a, b) => a + b, 0n)
		owed = assetsFor(total, nav)
		expect((await reader.committed()).result).toBe(owed)
	})

	it("a claim the vault cannot cover is refused and uncovered reports the gap", async () => {
		const v = vault(c, first)
		expectRefused(
			await v.claim_redeem({
				caller: first.publicKey(),
				epoch_id: redemptionEpoch,
			}),
			v,
			"ClaimNotCovered",
		)
		const liquid = (await reader.liquid_reserve()).result
		expect((await reader.uncovered()).result).toBe(owed - liquid)
		expect((await reader.uncovered()).result).toBeGreaterThan(0n)
	})

	it("refuses to deploy while anything is uncovered", async () => {
		const v = vault(c, treasury)
		expectRefused(
			await v.deploy_to_custodian({ caller: treasury.publicKey(), assets: 1n }),
			v,
			"ReserveCommittedToExits",
		)
	})

	it("fund returns the capital and the refused claims then pay", async () => {
		await send(
			vault(c, custodian).fund({
				from: custodian.publicKey(),
				assets: deployed(),
			}),
		)
		expect((await reader.uncovered()).result).toBe(0n)
		for (const holder of [first, second]) {
			const before = await usdcBalance(c, holder.publicKey())
			const paid = await send(
				vault(c, holder).claim_redeem({
					caller: holder.publicKey(),
					epoch_id: redemptionEpoch,
				}),
			)
			expect(paid).toBe(assetsFor(redeemed.get(holder.publicKey()) ?? 0n, nav))
			expect(await usdcBalance(c, holder.publicKey())).toBe(before + paid)
		}
		expect((await reader.committed()).result).toBe(0n)
	})
})

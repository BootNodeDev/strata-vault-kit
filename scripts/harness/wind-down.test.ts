import { beforeAll, describe, expect, it } from "vitest"

import { SHORT_WIND_DOWN_DIR, deployThrowaway, wasmOf } from "./deploy.js"
import { pay, trustline } from "./lib/accounts.js"
import { units } from "./lib/amounts.js"
import {
	connectTo,
	identityVerifier,
	send,
	shareToken,
	usdcBalance,
	vault,
	type Connected,
} from "./lib/clients.js"
import { network } from "./lib/network.js"
import { attest } from "./lib/oracle.js"
import { outcome } from "./lib/refused.js"

const net = network()
if (net.name !== "local") {
	throw new Error(
		"the wind-down run needs the local network: it deploys a vault built without the wind-down minimum",
	)
}

let c: Connected
let decimals = 7
const usdc = (whole: number) => units(whole, decimals)
const called = new Set<string>()

type Signer =
	"governance" | "manager" | "guardian" | "treasury" | "holder-1" | "outsider"

type Call = (args: Record<string, unknown>) => Promise<{
	simulation?: unknown
	result: unknown
	signAndSend(): Promise<{ result: unknown }>
}>

// Simulates one vault call, and sends it when it would succeed and `submit` is
// set. Either way the binding has encoded the arguments and reached the
// contract.
async function call(
	name: string,
	as: Signer,
	args: Record<string, unknown> = {},
	submit = false,
): Promise<string> {
	const client = vault(c, c.keys[as])
	const method = (client as unknown as Record<string, Call | undefined>)[name]
	if (method === undefined) throw new Error(`the vault client has no ${name}`)
	const tx = await method.call(client, args)
	called.add(name)
	const result = outcome(tx, client)
	if (submit && result === "accepted") await send(Promise.resolve(tx))
	return result
}

beforeAll(async () => {
	const deployment = await deployThrowaway(
		net,
		wasmOf("async_vault", SHORT_WIND_DOWN_DIR),
	)
	c = connectTo(net, deployment)
	decimals = (await shareToken(c, c.keys.outsider).decimals()).result
	const holder = c.keys["holder-1"]
	await trustline(c.net, c.server, holder, c.asset)
	await trustline(c.net, c.server, c.keys.custodian, c.asset)
	await pay(c.net, c.server, c.keys.issuer, holder.publicKey(), c.asset, "1000")
	await send(
		identityVerifier(c, c.keys.compliance).allow({
			account: holder.publicKey(),
			allowed: true,
			caller: c.keys.compliance.publicKey(),
		}),
	)
})

describe("a wind-down on a throwaway vault", () => {
	const holder = () => c.keys["holder-1"].publicKey()

	it("a holder subscribes, is priced and claims shares", async () => {
		expect(
			await call(
				"request_deposit",
				"holder-1",
				{ from: holder(), amount: usdc(200) },
				true,
			),
		).toBe("accepted")
		expect(
			await call(
				"close_epoch",
				"manager",
				{ caller: c.keys.manager.publicKey() },
				true,
			),
		).toBe("accepted")
		await attest(c, 2n * 10n ** 18n)
		expect(
			await call("fulfill_epoch", "outsider", { epoch_id: 1n }, true),
		).toBe("accepted")
		expect(
			await call(
				"claim_deposit",
				"holder-1",
				{ caller: holder(), epoch_id: 1n },
				true,
			),
		).toBe("accepted")
	})

	it("the holder asks to redeem part of it", async () => {
		expect(
			await call(
				"request_redeem",
				"holder-1",
				{ from: holder(), shares: usdc(10) },
				true,
			),
		).toBe("accepted")
	})

	it("governance proposes the wind-down and anyone activates it", async () => {
		const gov = c.keys.governance.publicKey()
		expect(
			await call("propose_wind_down", "governance", { caller: gov }, true),
		).toBe("accepted")
		expect(await call("activate_wind_down", "outsider", {}, true)).toBe(
			"accepted",
		)
	})

	it("anyone finalises a round and the holder claims", async () => {
		expect(await call("finalize_wind_down_round", "outsider", {}, true)).toBe(
			"accepted",
		)

		const reader = vault(c, c.keys.outsider)
		const owedBefore = (await reader.wind_down_owed()).result
		const claimableBefore = (
			await reader.wind_down_claimable({ holder: holder() })
		).result
		const balanceBefore = await usdcBalance(c, holder())

		called.add("claim_wind_down")
		const paid = await send(
			vault(c, c.keys["holder-1"]).claim_wind_down({ holder: holder() }),
		)

		expect(paid).toBeGreaterThan(0n)
		expect(paid).toBe(claimableBefore)
		expect(await usdcBalance(c, holder())).toBe(balanceBefore + paid)
		expect((await reader.wind_down_owed()).result).toBe(owedBefore - paid)
	})

	it("reads the economic supply after the claim", async () => {
		await call("total_economic_supply", "outsider")
	})

	it("every other vault function answers through its binding", async () => {
		const gov = c.keys.governance.publicKey()
		const someone = c.keys.outsider.publicKey()
		const views = [
			"asset",
			"share_token",
			"oracle",
			"governance",
			"manager",
			"treasury",
			"guardian",
			"custodian",
			"net_deployed",
			"free_reserve",
			"committed",
			"uncovered",
			"liquid_reserve",
			"cancellable_escrow",
			"pending_mint_shares",
			"pending_burn_shares",
			"deposit_cap",
			"wind_down_delay",
			"wind_down",
			"wind_down_owed",
			"wind_down_supply",
			"wind_down_acc",
			"notice",
			"current_epoch",
			"upgrade_delay",
			"schema_version",
			"pending_changes",
			"setup_open",
			"health",
			"timelock_clock",
			"get_admin",
			"get_existing_roles",
			"paused",
		]
		for (const name of views) await call(name, "outsider")
		await call("wind_down_claimable", "outsider", { holder: holder() })
		await call("get_epoch", "outsider", { epoch_id: 1n })
		await call("get_epoch_settlement", "outsider", { epoch_id: 1n })
		await call("get_deposit_request", "outsider", {
			epoch_id: 1n,
			controller: holder(),
		})
		await call("get_redeem_request", "outsider", {
			epoch_id: 2n,
			controller: holder(),
		})
		await call("has_role", "outsider", { account: gov, role: "manager" })
		await call("get_role_member_count", "outsider", { role: "manager" })
		await call("get_role_member", "outsider", { role: "manager", index: 0 })
		await call("get_role_admin", "outsider", { role: "manager" })

		// Writes the wind-down or the timelock refuses: the call still has to
		// encode and reach the contract.
		const refusedWrites: Array<[string, Signer, Record<string, unknown>]> = [
			["set_deposit_cap", "governance", { cap: 1n, caller: gov }],
			["set_custodian", "governance", { custodian: someone, caller: gov }],
			["set_wind_down_delay", "governance", { secs: 1n, caller: gov }],
			["cancel_wind_down_proposal", "governance", { caller: gov }],
			["set_notice", "governance", { secs: 1n, caller: gov }],
			["finish_setup", "governance", { caller: gov }],
			[
				"propose_change",
				"governance",
				{ change: { tag: "Custodian", values: [someone] }, caller: gov },
			],
			["cancel_change", "governance", { id: 1, caller: gov }],
			["apply_change", "governance", { id: 1, caller: gov }],
			[
				"deploy_to_custodian",
				"treasury",
				{ caller: c.keys.treasury.publicKey(), assets: 1n },
			],
			["fund", "outsider", { from: someone, assets: 1n }],
			["cancel_deposit", "holder-1", { from: holder(), epoch_id: 1n }],
			["cancel_redeem", "holder-1", { from: holder(), epoch_id: 2n }],
			["claim_redeem", "holder-1", { caller: holder(), epoch_id: 2n }],
			[
				"grant_role",
				"governance",
				{ account: someone, role: "manager", caller: gov },
			],
			[
				"revoke_role",
				"governance",
				{ account: someone, role: "manager", caller: gov },
			],
			["renounce_role", "outsider", { role: "manager", caller: someone }],
			[
				"transfer_admin_role",
				"governance",
				{ new_admin: someone, live_until_ledger: 1 },
			],
			["accept_admin_transfer", "outsider", {}],
			[
				"set_role_admin",
				"governance",
				{ role: "manager", admin_role: "guardian" },
			],
			["renounce_admin", "governance", {}],
			["pause", "guardian", { caller: c.keys.guardian.publicKey() }],
			["unpause", "governance", { caller: gov }],
		]
		for (const [name, as, args] of refusedWrites) await call(name, as, args)

		const spec = vault(c, c.keys.outsider).spec
		const every = spec
			.funcs()
			.map((f) => f.name().toString())
			.filter((name) => name !== "__constructor")
		expect(every.filter((name) => !called.has(name))).toEqual([])
	})
})

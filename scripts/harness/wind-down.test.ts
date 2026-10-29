import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
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
import { attest, freshFeed } from "./lib/oracle.js"
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

type VaultClient = ReturnType<typeof vault>
type VaultMethod = {
	[K in keyof VaultClient]-?: VaultClient[K] extends (
		...args: never[]
	) => Promise<AssembledTransaction<unknown>>
		? K
		: never
}[keyof VaultClient]
type ArgsOf<M extends VaultMethod> = Parameters<VaultClient[M]>
type NoArgMethod = {
	[M in VaultMethod]: ArgsOf<M> extends [options?: unknown] ? M : never
}[VaultMethod]

async function simulate<M extends VaultMethod>(
	name: M,
	as: Signer,
	args: ArgsOf<M>,
): Promise<{ tx: AssembledTransaction<unknown>; result: string }> {
	const client = vault(c, c.keys[as])
	const method = client[name] as (
		...a: ArgsOf<M>
	) => Promise<AssembledTransaction<unknown>>
	const tx = await method.call(client, ...args)
	called.add(name)
	return { tx, result: outcome(tx, client) }
}

async function call<M extends VaultMethod>(
	name: M,
	as: Signer,
	...args: ArgsOf<M>
): Promise<string> {
	return (await simulate(name, as, args)).result
}

// Sends the call too, once the simulation says the contract would accept it.
async function submit<M extends VaultMethod>(
	name: M,
	as: Signer,
	...args: ArgsOf<M>
): Promise<string> {
	const { tx, result } = await simulate(name, as, args)
	if (result === "accepted") await send(Promise.resolve(tx))
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
		}),
	)
})

describe("a wind-down on a throwaway vault", () => {
	const holder = () => c.keys["holder-1"].publicKey()

	it("a holder subscribes, is priced and claims shares", async () => {
		await freshFeed(c, 2n * 10n ** 18n)
		expect(
			await submit("request_deposit", "holder-1", {
				holder: holder(),
				amount: usdc(200),
			}),
		).toBe("accepted")
		expect(
			await submit("close_epoch", "manager", {
				caller: c.keys.manager.publicKey(),
			}),
		).toBe("accepted")
		await attest(c, 2n * 10n ** 18n)
		expect(await submit("fulfill_epoch", "outsider", { epoch_id: 1n })).toBe(
			"accepted",
		)
		expect(
			await submit("claim_deposit", "holder-1", {
				holder: holder(),
				epoch_id: 1n,
			}),
		).toBe("accepted")
	})

	it("the holder asks to redeem part of it", async () => {
		expect(
			await submit("request_redeem", "holder-1", {
				holder: holder(),
				shares: usdc(10),
			}),
		).toBe("accepted")
	})

	it("governance proposes the wind-down and anyone activates it", async () => {
		expect(await submit("propose_wind_down", "governance")).toBe("accepted")
		expect(
			await call("request_deposit", "holder-1", {
				holder: holder(),
				amount: usdc(1),
			}),
		).toBe("refused: WindDownAlreadyProposed")
		expect(await submit("activate_wind_down", "outsider")).toBe("accepted")
	})

	it("anyone finalises a round and the holder claims", async () => {
		expect(await submit("finalize_wind_down_round", "outsider")).toBe(
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
		expect(await call("total_economic_supply", "outsider")).toBe("accepted")
	})

	it("every other vault function answers through its binding", async () => {
		const gov = c.keys.governance.publicKey()
		const someone = c.keys.outsider.publicKey()
		const views: readonly NoArgMethod[] = [
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
			"wind_down_distributed",
			"notice",
			"current_epoch",
			"epoch_opened_at",
			"min_epoch_duration",
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
		for (const name of views)
			expect({ [name]: await call(name, "outsider") }).toEqual({
				[name]: "accepted",
			})
		expect(
			await call("wind_down_claimable", "outsider", { holder: holder() }),
			"wind_down_claimable",
		).toBe("accepted")
		expect(
			await call("get_epoch", "outsider", { epoch_id: 1n }),
			"get_epoch",
		).toBe("accepted")
		expect(
			await call("get_epoch_settlement", "outsider", { epoch_id: 1n }),
			"get_epoch_settlement",
		).toBe("accepted")
		expect(
			await call("get_deposit_request", "outsider", {
				epoch_id: 1n,
				holder: holder(),
			}),
			"get_deposit_request",
		).toBe("accepted")
		expect(
			await call("get_redeem_request", "outsider", {
				epoch_id: 2n,
				holder: holder(),
			}),
			"get_redeem_request",
		).toBe("accepted")
		expect(
			await call("has_role", "outsider", { account: gov, role: "manager" }),
			"has_role",
		).toBe("accepted")
		expect(
			await call("get_role_member_count", "outsider", { role: "manager" }),
			"get_role_member_count",
		).toBe("accepted")
		expect(
			await call("get_role_member", "outsider", {
				role: "manager",
				index: 0,
			}),
			"get_role_member",
		).toBe("accepted")
		expect(
			await call("get_role_admin", "outsider", { role: "manager" }),
			"get_role_admin",
		).toBe("accepted")

		// Simulated, never sent — each still reaches the contract for its
		// wind-down answer.
		expect(
			await call("set_deposit_cap", "governance", { cap: 1n }),
			"set_deposit_cap",
		).toBe("accepted")
		expect(
			await call("set_custodian", "governance", { custodian: someone }),
			"set_custodian",
		).toBe("refused: UseTimelock")
		expect(
			await call("set_wind_down_delay", "governance", { secs: 1n }),
			"set_wind_down_delay",
		).toBe("accepted")
		expect(
			await call("cancel_wind_down_proposal", "governance"),
			"cancel_wind_down_proposal",
		).toBe("refused: WindDownActive")
		expect(
			await call("set_notice", "governance", { secs: 1n }),
			"set_notice",
		).toBe("accepted")
		expect(
			await call("set_min_epoch_duration", "governance", { secs: 86_400n }),
			"set_min_epoch_duration",
		).toBe("refused: UseTimelock")
		expect(await call("finish_setup", "governance"), "finish_setup").toBe(
			"refused: SetupClosed",
		)
		expect(
			await call("propose_change", "governance", {
				change: { tag: "Custodian", values: [someone] },
			}),
			"propose_change",
		).toBe("refused: WindDownActive")
		expect(
			await call("cancel_change", "governance", { id: 1 }),
			"cancel_change",
		).toBe("refused: ChangeNotFound")
		expect(
			await call("apply_change", "governance", { id: 1 }),
			"apply_change",
		).toBe("refused: ChangeNotFound")
		expect(
			await call("deploy_to_custodian", "treasury", {
				caller: c.keys.treasury.publicKey(),
				assets: 1n,
			}),
			"deploy_to_custodian",
		).toBe("refused: WindDownActive")
		expect(
			await call("fund", "holder-1", { caller: holder(), assets: 1n }),
			"fund",
		).toBe("accepted")
		expect(
			await call("cancel_deposit", "holder-1", {
				holder: holder(),
				epoch_id: 1n,
			}),
			"cancel_deposit",
		).toBe("refused: AlreadyPriced")
		expect(
			await call("cancel_redeem", "holder-1", {
				holder: holder(),
				epoch_id: 2n,
			}),
			"cancel_redeem",
		).toBe("accepted")
		expect(
			await call("claim_redeem", "holder-1", {
				holder: holder(),
				epoch_id: 2n,
			}),
			"claim_redeem",
		).toBe("refused: EpochNotFulfilled")
		expect(
			await call("grant_role", "governance", {
				account: someone,
				role: "manager",
				caller: gov,
			}),
			"grant_role",
		).toBe("refused: UseTimelock")
		expect(
			await call("revoke_role", "governance", {
				account: someone,
				role: "manager",
				caller: gov,
			}),
			"revoke_role",
		).toBe("refused: UseTimelock")
		expect(
			await call("renounce_role", "outsider", {
				role: "manager",
				caller: someone,
			}),
			"renounce_role",
		).toBe("refused: RoleNotHeld")
		expect(
			await call("transfer_admin_role", "governance", {
				new_admin: someone,
				live_until_ledger: 1,
			}),
			"transfer_admin_role",
		).toBe("refused: UseTimelock")
		expect(
			await call("accept_admin_transfer", "outsider"),
			"accept_admin_transfer",
		).toBe("refused: WindDownActive")
		expect(
			await call("set_role_admin", "governance", {
				role: "manager",
				admin_role: "guardian",
			}),
			"set_role_admin",
		).toBe("refused: UseTimelock")
		expect(await call("renounce_admin", "governance"), "renounce_admin").toBe(
			"refused: AdminRequired",
		)
		expect(
			await call("pause", "guardian", {
				caller: c.keys.guardian.publicKey(),
			}),
			"pause",
		).toBe("accepted")
		expect(
			await call("unpause", "governance", { caller: gov }),
			"unpause",
		).toBe("refused: ExpectedPause")

		const spec = vault(c, c.keys.outsider).spec
		const every = spec
			.funcs()
			.map((f) => f.name().toString())
			.filter((name) => name !== "__constructor")
		expect(every.filter((name) => !called.has(name))).toEqual([])
	})
})

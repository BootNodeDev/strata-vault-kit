import { beforeAll, describe, expect, it } from "vitest"

import { exampleWasmOf } from "./deploy.js"
import { price } from "./lib/amounts.js"
import { deployContract } from "./lib/cli.js"
import {
	connect,
	oracle,
	send,
	sep40Consumer,
	sep40Feed,
	simulationEvents,
	type Connected,
} from "./lib/clients.js"
import { freshFeed } from "./lib/oracle.js"
import { recordedEvent, stellarAsset } from "./lib/sep40.js"

const c: Connected = connect()
const share = stellarAsset(c.deployment.contracts.share_token)

let nav = price(1)
let consumerId = ""

describe("a third-party contract reads the share price through SEP-40", () => {
	beforeAll(async () => {
		// The vault prices at the oracle's standing valuation, so the run
		// attests it again rather than a price the deviation cap could refuse.
		try {
			nav = (await oracle(c, c.keys.outsider).latest()).result.nav_per_share
		} catch {
			nav = price(1)
		}
	})

	it("deploys the consumer", async () => {
		consumerId = await deployContract(
			c.net,
			exampleWasmOf("sep40_consumer"),
			c.keys.deployer,
			[],
		)
		console.log(`sep40_consumer ${consumerId}`)
	})

	it("the feed has a price to read", async () => {
		await freshFeed(c, nav)
		const quote = (
			await sep40Feed(c, c.keys.outsider).lastprice({ asset: share })
		).result
		expect(quote).not.toBeNull()
	})

	it("the consumer records the price in one transaction", async () => {
		const tx = await sep40Consumer(c, consumerId, c.keys.outsider).record_price(
			{
				feed: c.deployment.contracts.sep40_feed,
				asset: share,
			},
		)
		expect(recordedEvent(simulationEvents(tx))).toBe("price_recorded")
		await send(Promise.resolve(tx), "record_price")
	})
})

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
import { decodedEvent, stellarAsset } from "./lib/sep40.js"

const c: Connected = connect()
const share = stellarAsset(c.deployment.contracts.share_token)
// scValToNative has no contract spec to name the enum's fields, so it
// decodes a sep40::Asset as a plain [tag, ...values] array, not {tag, values}.
const shareNative = [share.tag, ...share.values]

let nav = price(1)
let consumerId = ""
let quote: { price: bigint; timestamp: bigint } | null = null

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
		quote = (await sep40Feed(c, c.keys.outsider).lastprice({ asset: share }))
			.result
		expect(quote).not.toBeNull()
	})

	it("the consumer records the price in one transaction", async () => {
		const feed = sep40Feed(c, c.keys.outsider)
		const tx = await sep40Consumer(c, consumerId, c.keys.outsider).record_price(
			{
				feed: c.deployment.contracts.sep40_feed,
				asset: share,
			},
		)
		const decoded = decodedEvent(simulationEvents(tx))
		expect(decoded?.name).toBe("price_recorded")
		expect(decoded?.topics).toEqual([
			c.deployment.contracts.sep40_feed,
			shareNative,
		])
		expect(decoded?.data).toEqual({
			price: quote?.price,
			timestamp: quote?.timestamp,
			decimals: (await feed.decimals()).result,
			resolution: (await feed.resolution()).result,
		})
		// record_price writes no storage, so the SDK treats it as a read call.
		await send(Promise.resolve(tx), "record_price", { force: true })
	})
})

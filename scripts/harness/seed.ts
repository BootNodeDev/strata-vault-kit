import { type Keypair } from "@stellar/stellar-sdk"

import { pay, trustline } from "./lib/accounts.js"
import { price, units } from "./lib/amounts.js"
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

function formatAmount(amount: bigint, decimals: number): string {
	const factor = 10n ** BigInt(decimals)
	const whole = amount / factor
	const fraction = amount % factor
	return `${whole}.${fraction.toString().padStart(decimals, "0").slice(0, 4)}`
}

function formatWad(wad: bigint): string {
	const factor = 10n ** 18n
	const whole = wad / factor
	const fraction = wad % factor
	return `$${whole}.${fraction.toString().padStart(18, "0").slice(0, 4)}`
}

async function hasTrustline(c: Connected, address: string): Promise<boolean> {
	try {
		await c.server.getAssetBalance(address, c.asset, c.net.passphrase)
		return true
	} catch (error) {
		if (
			error instanceof Error &&
			/Trustline for .* not found for/.test(error.message)
		) {
			return false
		}
		throw error
	}
}

async function ensureTrustline(
	c: Connected,
	holder: Keypair,
	name: string,
): Promise<void> {
	const exists = await hasTrustline(c, holder.publicKey())
	if (!exists) {
		console.log(`  + establishing USDC trustline for ${name}...`)
		await trustline(c.net, c.server, holder, c.asset)
		console.log(`  ✓ established trustline for ${name}`)
	} else {
		console.log(`  • ${name} trustline verified`)
	}
}

async function ensureFunding(
	c: Connected,
	holder: Keypair,
	name: string,
	minUsdcWhole: number,
	topUpUsdcWhole: number,
	decimals: number,
): Promise<void> {
	const minBalance = units(minUsdcWhole, decimals)
	const current = await usdcBalance(c, holder.publicKey())
	if (current < minBalance) {
		console.log(
			`  + funding ${name} with ${topUpUsdcWhole} USDC (current: ${formatAmount(current, decimals)})...`,
		)
		await pay(
			c.net,
			c.server,
			c.keys.issuer,
			holder.publicKey(),
			c.asset,
			topUpUsdcWhole.toString(),
		)
		const updated = await usdcBalance(c, holder.publicKey())
		console.log(
			`  ✓ funded ${name}, new balance: ${formatAmount(updated, decimals)} USDC`,
		)
	} else {
		console.log(
			`  • ${name} has sufficient USDC: ${formatAmount(current, decimals)}`,
		)
	}
}

async function ensureAllowlist(
	c: Connected,
	holder: Keypair,
	name: string,
): Promise<void> {
	const verifier = identityVerifier(c, c.keys.governance)
	const allowed = (await verifier.is_allowed({ account: holder.publicKey() }))
		.result
	if (!allowed) {
		console.log(`  + allowlisting ${name}...`)
		await send(
			verifier.allow({
				account: holder.publicKey(),
				allowed: true,
				caller: c.keys.governance.publicKey(),
			}),
		)
		console.log(`  ✓ ${name} allowlisted`)
	} else {
		console.log(`  • ${name} is already allowlisted`)
	}
}

async function main(): Promise<void> {
	console.log("==================================================")
	console.log("       STRATA VAULT SEED SCRIPT (TESTNET)         ")
	console.log("==================================================\n")

	const c: Connected = connect()
	const {
		governance,
		manager,
		treasury,
		custodian,
		outsider,
		"holder-1": holder1,
		"holder-2": holder2,
		"holder-3": holder3,
	} = c.keys

	const reader = vault(c, outsider)
	const tokenReader = shareToken(c, outsider)
	const decimals = (await tokenReader.decimals()).result
	const usdc = (whole: number) => units(whole, decimals)

	console.log(`Network: ${c.net.name} (${c.net.rpcUrl})`)
	console.log(`Vault Contract:       ${c.deployment.contracts.async_vault}`)
	console.log(`Share Token Contract: ${c.deployment.contracts.share_token}`)
	console.log(`NAV Oracle Contract:  ${c.deployment.contracts.nav_oracle}`)
	console.log(`Deposit Asset:        ${c.asset.code} (${c.asset.issuer})\n`)

	// 1. Ensure Custodian and Trustlines
	console.log("Step 1: Verifying accounts, trustlines, and allowlist...")
	for (const [name, key] of [
		["custodian", custodian],
		["holder-1", holder1],
		["holder-2", holder2],
		["holder-3", holder3],
	] as const) {
		await ensureTrustline(c, key, name)
	}

	for (const [name, key] of [
		["holder-1", holder1],
		["holder-2", holder2],
		["holder-3", holder3],
	] as const) {
		await ensureFunding(c, key, name, 10_000, 50_000, decimals)
		await ensureAllowlist(c, key, name)
	}

	// Ensure vault custodian is configured
	const currentCustodian = (await reader.custodian()).result
	if (!currentCustodian) {
		console.log("  + setting vault custodian...")
		await send(
			vault(c, governance).set_custodian({
				custodian: custodian.publicKey(),
				caller: governance.publicKey(),
			}),
		)
		console.log(`  ✓ custodian configured: ${custodian.publicKey()}`)
	} else {
		console.log(`  • vault custodian already configured: ${currentCustodian}`)
	}

	// 2. Lifecycle Seeding
	console.log("\nStep 2: Processing Vault Lifecycle...")
	let currentEpoch = (await reader.current_epoch()).result
	console.log(`Current epoch: ${currentEpoch}`)

	if (currentEpoch === 1n) {
		const ep1 = (await reader.get_epoch({ epoch_id: 1n })).result
		const status = ep1?.status.tag ?? "Open"
		console.log(`Epoch 1 status: ${status}`)

		if (status === "Open") {
			console.log(
				"  + requesting deposits in Epoch 1 (holder-1: 5,000 USDC, holder-2: 3,000 USDC)...",
			)
			await send(
				vault(c, holder1).request_deposit({
					from: holder1.publicKey(),
					amount: usdc(5_000),
				}),
			)
			await send(
				vault(c, holder2).request_deposit({
					from: holder2.publicKey(),
					amount: usdc(3_000),
				}),
			)
			console.log("  ✓ deposits requested in Epoch 1")

			console.log("  + closing Epoch 1...")
			await send(vault(c, manager).close_epoch({ caller: manager.publicKey() }))
			console.log("  ✓ Epoch 1 closed")

			const nav = price(1) // $1.00 NAV
			console.log(`  + attesting NAV (${formatWad(nav)})...`)
			await attest(c, nav)
			console.log("  ✓ NAV attested on oracle")

			console.log("  + fulfilling Epoch 1...")
			await send(vault(c, outsider).fulfill_epoch({ epoch_id: 1n }))
			console.log("  ✓ Epoch 1 fulfilled")

			console.log("  + claiming shares for holder-1 and holder-2...")
			await send(
				vault(c, holder1).claim_deposit({
					caller: holder1.publicKey(),
					epoch_id: 1n,
				}),
			)
			await send(
				vault(c, holder2).claim_deposit({
					caller: holder2.publicKey(),
					epoch_id: 1n,
				}),
			)
			console.log("  ✓ shares claimed for Epoch 1")
		}
	}

	// Update current epoch after potential transition
	currentEpoch = (await reader.current_epoch()).result
	console.log(`\nCurrent active epoch: ${currentEpoch}`)

	// 3. Treasury Deployment to Custodian
	console.log("\nStep 3: Treasury Reserve Deployment...")
	const freeReserve = (await reader.free_reserve()).result
	console.log(
		`Free reserve available in vault: ${formatAmount(freeReserve, decimals)} USDC`,
	)
	if (freeReserve >= usdc(4_000)) {
		console.log("  + deploying 4,000 USDC to custodian...")
		await send(
			vault(c, treasury).deploy_to_custodian({
				caller: treasury.publicKey(),
				assets: usdc(4_000),
			}),
		)
		console.log("  ✓ 4,000 USDC deployed to custodian")
	} else {
		console.log(
			"  • reserve already deployed or below threshold, skipping deployment",
		)
	}

	// 4. Open Epoch Pending Requests (for explorer/UI live testing)
	console.log(
		"\nStep 4: Populating Active Pipeline in Epoch " + currentEpoch + "...",
	)
	const epInfo = (await reader.get_epoch({ epoch_id: currentEpoch })).result
	const epStatus = epInfo?.status.tag ?? "Open"

	if (epStatus === "Open") {
		const h1Shares = (
			await tokenReader.balance({ account: holder1.publicKey() })
		).result
		const h1RedeemReq = (
			await reader.get_redeem_request({
				epoch_id: currentEpoch,
				controller: holder1.publicKey(),
			})
		).result
		if (!h1RedeemReq && h1Shares >= usdc(1_000)) {
			console.log("  + holder-1 requesting redemption of 1,000 shares...")
			await send(
				vault(c, holder1).request_redeem({
					from: holder1.publicKey(),
					shares: usdc(1_000),
				}),
			)
			console.log("  ✓ holder-1 redemption requested")
		} else if (h1RedeemReq) {
			console.log(
				`  • holder-1 already has pending redemption of ${formatAmount(h1RedeemReq.shares, decimals)} shares`,
			)
		}

		const h3DepositReq = (
			await reader.get_deposit_request({
				epoch_id: currentEpoch,
				controller: holder3.publicKey(),
			})
		).result
		if (!h3DepositReq) {
			console.log("  + holder-3 requesting deposit of 2,500 USDC...")
			await send(
				vault(c, holder3).request_deposit({
					from: holder3.publicKey(),
					amount: usdc(2_500),
				}),
			)
			console.log("  ✓ holder-3 deposit requested")
		} else {
			console.log(
				`  • holder-3 already has pending deposit of ${formatAmount(h3DepositReq.amount, decimals)} USDC`,
			)
		}
	}

	// 5. Query and Print Final State Summary
	console.log("\n==================================================")
	console.log("             VAULT SEED STATE SUMMARY             ")
	console.log("==================================================\n")

	const finalEpoch = (await reader.current_epoch()).result
	const finalFree = (await reader.free_reserve()).result
	const finalEscrow = (await reader.cancellable_escrow()).result
	const custodianBal = await usdcBalance(c, custodian.publicKey())
	const vaultUsdc = await usdcBalance(c, c.deployment.contracts.async_vault)
	const oracleLatest = (await oracle(c, outsider).latest()).result

	console.log("--- ON-CHAIN METRICS ---")
	console.log(`Current Epoch:         #${finalEpoch} (Open)`)
	console.log(
		`Vault Liquid USDC:     ${formatAmount(vaultUsdc, decimals)} USDC`,
	)
	console.log(
		`  ├─ Free Reserve:     ${formatAmount(finalFree, decimals)} USDC`,
	)
	console.log(
		`  └─ Pending Escrow:   ${formatAmount(finalEscrow, decimals)} USDC`,
	)
	console.log(
		`Custodian Deployed:    ${formatAmount(custodianBal, decimals)} USDC`,
	)
	console.log(
		`Total Value Locked:    ${formatAmount(finalFree + custodianBal, decimals)} USDC (NAV basis)`,
	)
	console.log(`Latest Attested NAV:   ${formatWad(oracleLatest.nav_per_share)}`)

	console.log("\n--- CONTRACT ADDRESSES ---")
	console.table(c.deployment.contracts)

	console.log("\n--- DEMO ACCOUNTS & ROLES ---")
	const accountsSummary = []
	for (const [role, keypair] of Object.entries(c.keys)) {
		const pub = keypair.publicKey()
		const usdcBal = await usdcBalance(c, pub)
		const shares = (await tokenReader.balance({ account: pub })).result
		accountsSummary.push({
			Role: role,
			PublicKey: pub,
			SecretKey: keypair.secret(),
			"USDC Balance": formatAmount(usdcBal, decimals),
			"Shares Balance": formatAmount(shares, decimals),
		})
	}
	console.table(accountsSummary, [
		"Role",
		"PublicKey",
		"USDC Balance",
		"Shares Balance",
	])

	console.log("\n--- ACTIVE REQUESTS IN EPOCH #" + finalEpoch + " ---")
	const activeRequests = []
	for (const [name, key] of [
		["holder-1", holder1],
		["holder-2", holder2],
		["holder-3", holder3],
	] as const) {
		const depReq = (
			await reader.get_deposit_request({
				epoch_id: finalEpoch,
				controller: key.publicKey(),
			})
		).result
		const redReq = (
			await reader.get_redeem_request({
				epoch_id: finalEpoch,
				controller: key.publicKey(),
			})
		).result
		if (depReq) {
			activeRequests.push({
				Account: name,
				Type: "Deposit",
				Amount: `${formatAmount(depReq.amount, decimals)} USDC`,
				Claimed: depReq.claimed,
			})
		}
		if (redReq) {
			activeRequests.push({
				Account: name,
				Type: "Redeem",
				Amount: `${formatAmount(redReq.shares, decimals)} Shares`,
				Claimed: redReq.claimed,
			})
		}
	}
	console.table(activeRequests)

	console.log("\n==================================================")
	console.log("       TESTNET SEEDING COMPLETED SUCCESSFULLY     ")
	console.log("==================================================\n")
}

main().catch((err: unknown) => {
	console.error("\n❌ Seed script failed:", err)
	process.exit(1)
})

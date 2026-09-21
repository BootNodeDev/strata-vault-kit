import { Networks } from "@creit.tech/stellar-wallets-kit"
import { networkPassphrase, stellarNetwork } from "./env"

/** Shorten a Stellar address/contract id: first 4 + last 4, ellipsised. */
export const shortAddress = (addr: string): string =>
	`${addr.slice(0, 4)}...${addr.slice(-4)}`

/** Grouped, two decimals. Display only: a claim is signed in contract units. */
export const formatAmount = (value: number): string =>
	value.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})

/** Human-friendly network label (STANDALONE → Local; otherwise capitalized). */
export const formatNetworkName = (name: string): string =>
	name === "STANDALONE"
		? "Local"
		: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()

/** Reverse lookup of a network passphrase to its `Networks` enum key. */
const passphraseToName: Record<string, string> = Object.fromEntries(
	Object.entries(Networks).map(([name, passphrase]) => [passphrase, name]),
)

export type NetworkState = "disconnected" | "mismatch" | "ok" | "unverified"

/**
 * Compare the app's configured network against the connected wallet's network
 * using passphrase. Most wallets don't report their network (Wallets Kit issue
 * #62) — a connected wallet with no passphrase is `unverified`, not a mismatch.
 * Keep pure, let component decide how to present state.
 */
export function networkStatus(
	address: string | null | undefined,
	walletPassphrase: string | null | undefined,
): {
	appNetwork: string
	walletNetwork: string
	state: NetworkState
	title: string
} {
	const appNetwork = formatNetworkName(stellarNetwork)
	// Label, in priority order: blank when there's no passphrase (disconnected);
	// the app's own label when the wallet matches the configured passphrase (so a
	// custom/standalone passphrase still reads as e.g. "Local" rather than
	// "Unknown" in the `ok` case); the known `Networks` name; else "Unknown".
	const walletNetwork = !walletPassphrase
		? ""
		: walletPassphrase === networkPassphrase
			? appNetwork
			: passphraseToName[walletPassphrase]
				? formatNetworkName(passphraseToName[walletPassphrase])
				: "Unknown"

	if (!address) {
		return {
			appNetwork,
			walletNetwork,
			state: "disconnected",
			title: "Connect your wallet using this network.",
		}
	}
	if (!walletPassphrase) {
		return {
			appNetwork,
			walletNetwork,
			state: "unverified",
			title: `This wallet doesn't report its network — make sure it is set to ${appNetwork}.`,
		}
	}
	if (walletPassphrase !== networkPassphrase) {
		return {
			appNetwork,
			walletNetwork,
			state: "mismatch",
			title: `Wallet is on ${walletNetwork}, connect to ${appNetwork} instead.`,
		}
	}
	return { appNetwork, walletNetwork, state: "ok", title: "" }
}

export const AMOUNT_DECIMALS = 7 as const
export const PRICE_DECIMALS = 18 as const
export type Decimals = typeof AMOUNT_DECIMALS | typeof PRICE_DECIMALS

declare const scale: unique symbol
/** A bigint branded with its decimal scale, so an `Amount` and a `Price` can't be swapped by mistake. */
export type Scaled<D extends Decimals> = bigint & { readonly [scale]: D }
/** Asset units and share counts, scaled by `AMOUNT_DECIMALS`. */
export type Amount = Scaled<typeof AMOUNT_DECIMALS>
/** WAD share price, scaled by `PRICE_DECIMALS`. */
export type Price = Scaled<typeof PRICE_DECIMALS>

/**
 * Render a scaled contract value as a decimal string. Stays exact above
 * `Number.MAX_SAFE_INTEGER` because it never builds a `Number`; extra
 * fraction digits are truncated, never rounded up.
 *
 * `decimals` is `NoInfer<D>`: `D` is resolved from `value` alone, then
 * `decimals` is checked against that resolved scale. Without `NoInfer`, TS
 * infers `D` from both parameters independently and widens the mismatch away
 * instead of rejecting it — `formatUnits(price, AMOUNT_DECIMALS)` must fail
 * to compile, not silently pass with a widened `D`.
 */
export function formatUnits<D extends Decimals>(
	value: Scaled<D>,
	decimals: NoInfer<D>,
	fractionDigits = 2,
): string {
	const negative = value < 0n
	const magnitude = negative ? -value : value
	const divisor = 10n ** BigInt(decimals)
	const integerPart = magnitude / divisor
	const remainder = magnitude % divisor
	const fraction = remainder
		.toString()
		.padStart(decimals, "0")
		.padEnd(fractionDigits, "0")
		.slice(0, fractionDigits)
	const sign = negative ? "-" : ""
	return fractionDigits > 0
		? `${sign}${integerPart}.${fraction}`
		: `${sign}${integerPart}`
}

export function formatScaled<D extends Decimals>(
	value: Scaled<D>,
	decimals: NoInfer<D>,
	fractionDigits = 2,
): string {
	const negative = value < 0n
	const magnitude = negative ? -value : value
	const divisor = 10n ** BigInt(decimals)
	const integerPart = magnitude / divisor
	const remainder = magnitude % divisor
	const fraction = remainder
		.toString()
		.padStart(decimals, "0")
		.padEnd(fractionDigits, "0")
		.slice(0, fractionDigits)
	const sign = negative ? "-" : ""
	const grouped = integerPart.toLocaleString("en-US")
	return fractionDigits > 0
		? `${sign}${grouped}.${fraction}`
		: `${sign}${grouped}`
}

/**
 * Parse investor input into a scaled contract value. `null` for anything the
 * chain cannot represent exactly, including more fraction digits than
 * `decimals` — that is never silently truncated.
 */
export function parseUnits<D extends Decimals>(
	input: string,
	decimals: D,
): Scaled<D> | null {
	const cleaned = input.replace(/[,\s]/g, "")
	if (!/^-?\d*(\.\d*)?$/.test(cleaned) || !/\d/.test(cleaned)) return null

	const negative = cleaned.startsWith("-")
	const unsigned = negative ? cleaned.slice(1) : cleaned
	const [integerPart = "", fractionPart = ""] = unsigned.split(".")
	if (fractionPart.length > decimals) return null

	const digits = (integerPart || "0") + fractionPart.padEnd(decimals, "0")
	const magnitude = BigInt(digits)
	return (negative ? -magnitude : magnitude) as Scaled<D>
}

/**
 * Narrow an `Amount` to a JS `number` for the rare display prop that requires
 * one. `null` when the integer part would lose precision above
 * `Number.MAX_SAFE_INTEGER`. Takes no `decimals` on purpose: a `Price` (18
 * decimals) has no safe caller here, so narrowing one is a type error, not a
 * convention to remember.
 */
export function toSafeNumber(value: Amount): number | null {
	const negative = value < 0n
	const magnitude = negative ? -value : value
	const divisor = 10n ** BigInt(AMOUNT_DECIMALS)
	const integerPart = magnitude / divisor
	const remainder = magnitude % divisor
	// At the boundary the integer part is representable but adding any fraction
	// rounds past it, so a non-zero remainder there is still a loss.
	const limit = BigInt(Number.MAX_SAFE_INTEGER)
	if (integerPart > limit || (integerPart === limit && remainder !== 0n)) {
		return null
	}

	const result = Number(integerPart) + Number(remainder) / Number(divisor)
	return negative ? -result : result
}

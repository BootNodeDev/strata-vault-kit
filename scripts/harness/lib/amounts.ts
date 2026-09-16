import { Asset } from "@stellar/stellar-sdk"

export const WAD = 10n ** 18n
export const PRICE_SCALE = WAD

export const XLM = Asset.native()
export const XLM_DECIMALS = 7
export const xlm = (whole: number): bigint => units(whole, XLM_DECIMALS)

export const price = (whole: number): bigint => BigInt(whole) * PRICE_SCALE

export const units = (whole: number, decimals: number): bigint =>
	BigInt(whole) * 10n ** BigInt(decimals)

// Both floor, as the contract's checked_mul_div_floor does.
export const sharesFor = (assets: bigint, sharePrice: bigint): bigint =>
	(assets * PRICE_SCALE) / sharePrice

export const assetsFor = (shares: bigint, sharePrice: bigint): bigint =>
	(shares * sharePrice) / PRICE_SCALE

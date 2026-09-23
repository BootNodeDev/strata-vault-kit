import {
	AMOUNT_DECIMALS,
	type Amount,
	formatAmount,
	formatDate,
	formatScaled,
	PRICE_DECIMALS,
} from "@stellar-scaffold/app-lib"
import { type AddressRow, type FigureRow } from "../components/vault/AboutVault"
import { type Metric } from "../components/vault/MetricsStrip"
import { type NavClassification } from "../hooks/useNavPrice"
import {
	type AuthorityKey,
	type VaultAuthorities,
} from "../hooks/useVaultAuthorities"
import { type VaultFigures } from "../hooks/useVaultFigures"

export function toMetrics(
	figures: VaultFigures | undefined,
	isPending: boolean,
	tokenSymbol: string,
): [Metric, Metric, Metric] {
	const metric = (label: string, raw: Amount | null, note: string): Metric =>
		isPending
			? { label, value: null, note, pending: true }
			: {
					label,
					value: raw === null ? null : formatScaled(raw, AMOUNT_DECIMALS),
					note,
				}

	const uncoveredNote = (uncovered: Amount | null): string => {
		if (isPending) return `${tokenSymbol} not covered`
		if (uncovered === null) return "Could not read the vault"
		return uncovered > 0n
			? `${tokenSymbol} still needed`
			: "Every claim is covered"
	}

	const uncovered = figures?.uncovered ?? null

	return [
		metric(
			"Liquid reserve",
			figures?.liquidReserve ?? null,
			`${tokenSymbol} the vault holds now`,
		),
		metric(
			"Committed",
			figures?.committed ?? null,
			`${tokenSymbol} owed on priced claims`,
		),
		metric("Uncovered · vault", uncovered, uncoveredNote(uncovered)),
	]
}

const AUTHORITY_LABELS: [AuthorityKey, string][] = [
	["governance", "Governance"],
	["manager", "Manager"],
	["treasury", "Treasury"],
	["guardian", "Guardian"],
	["custodian", "Custodian"],
]

export function toAuthorityRows(
	authorities: VaultAuthorities | undefined,
	isPending: boolean,
): AddressRow[] {
	return AUTHORITY_LABELS.map(([key, label]) =>
		isPending
			? { label, address: null, pending: true }
			: { label, address: authorities?.[key] ?? null },
	)
}

const priceNote = (nav: NavClassification | undefined): string => {
	switch (nav?.status) {
		case "valid":
			return `Attested ${formatDate(nav.attestedAt)}`
		case "stale":
			return `Price expired ${formatDate(nav.expiresAt)}`
		case "paused":
			return "Oracle paused"
		case "never":
			return "No price attested yet"
		default:
			return "Could not read the oracle"
	}
}

export function toPriceMetric(
	nav: NavClassification | undefined,
	isPending: boolean,
): Metric {
	if (isPending) {
		return {
			label: "Share price",
			value: null,
			note: "Reading the oracle",
			pending: true,
		}
	}

	return {
		label: "Share price",
		value:
			nav?.status === "valid"
				? formatScaled(nav.price, PRICE_DECIMALS, 4)
				: null,
		note: priceNote(nav),
	}
}

export function toEstimate(
	nav: NavClassification | undefined,
	parsedAmount: number | null,
	isSubscribe: boolean,
	outTicker: string,
): string | null {
	if (nav?.status !== "valid" || parsedAmount === null) return null
	const price = Number(nav.price) / 10 ** PRICE_DECIMALS
	const result = isSubscribe ? parsedAmount / price : parsedAmount * price
	return `≈ ${formatAmount(result)} ${outTicker}`
}

export function toSizeFigures(
	figures: VaultFigures | undefined,
	isPending: boolean,
): FigureRow[] {
	const figure = (label: string, raw: Amount | null): FigureRow =>
		isPending
			? { label, value: null, pending: true }
			: {
					label,
					value: raw === null ? null : formatScaled(raw, AMOUNT_DECIMALS),
				}

	return [
		figure("Economic supply", figures?.economicSupply ?? null),
		figure("Net deployed", figures?.netDeployed ?? null),
	]
}

import {
	AMOUNT_DECIMALS,
	type Amount,
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
		if (isPending) return "TOKEN not covered"
		if (uncovered === null) return "Could not read the vault"
		return uncovered > 0n ? "TOKEN still needed" : "Every claim is covered"
	}

	const uncovered = figures?.uncovered ?? null

	return [
		metric(
			"Liquid reserve",
			figures?.liquidReserve ?? null,
			"TOKEN the vault holds now",
		),
		metric(
			"Committed",
			figures?.committed ?? null,
			"TOKEN owed on priced claims",
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

	switch (nav?.status) {
		case "valid":
			return {
				label: "Share price",
				value: formatScaled(nav.price, PRICE_DECIMALS, 4),
				note: `Attested ${formatDate(nav.attestedAt)}`,
			}
		case "stale":
			return {
				label: "Share price",
				value: null,
				note: `Price expired ${formatDate(nav.expiresAt)}`,
			}
		case "paused":
			return { label: "Share price", value: null, note: "Oracle paused" }
		case "never":
			return {
				label: "Share price",
				value: null,
				note: "No price attested yet",
			}
		default:
			return {
				label: "Share price",
				value: null,
				note: "Could not read the oracle",
			}
	}
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

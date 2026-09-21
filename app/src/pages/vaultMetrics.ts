import {
	AMOUNT_DECIMALS,
	type Amount,
	formatScaled,
} from "@stellar-scaffold/app-lib"
import { type Metric } from "../components/vault/MetricsStrip"
import { type VaultFigures } from "../hooks/useVaultFigures"

const uncoveredNote = (
	uncovered: Amount | null,
	isPending: boolean,
): string => {
	if (isPending) return "TOKEN not covered"
	if (uncovered === null) return "Could not read the vault"
	return uncovered > 0n ? "TOKEN still needed" : "Every claim is covered"
}

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
		metric("Uncovered · vault", uncovered, uncoveredNote(uncovered, isPending)),
	]
}

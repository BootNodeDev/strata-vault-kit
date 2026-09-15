import { formatAmount } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./ActionPanel.module.css"

export type ActionPanelSide = "subscribe" | "redeem"

export type ActionPanelEstimate = {
	label: string
	value: string | null
	note: string
}

export type ActionPanelProps = {
	side: ActionPanelSide
	onSideChange: (side: ActionPanelSide) => void
	heading: string
	note?: string
	amount: string
	onAmountChange: (amount: string) => void
	amountLabel: string
	ticker: string
	balance: number
	balanceLabel: string
	estimate: ActionPanelEstimate
	submitLabel: string
	onSubmit: () => void
	footnote: string
	blockedReason?: string
}

const parseAmount = (raw: string): number | null => {
	const value = Number(raw.replace(/,/g, ""))
	return Number.isFinite(value) && value > 0 ? value : null
}

const ActionPanel: React.FC<ActionPanelProps> = ({
	side,
	onSideChange,
	heading,
	note,
	amount,
	onAmountChange,
	amountLabel,
	ticker,
	balance,
	balanceLabel,
	estimate,
	submitLabel,
	onSubmit,
	footnote,
	blockedReason,
}) => {
	const parsedAmount = parseAmount(amount)
	const isOverBalance = parsedAmount !== null && parsedAmount > balance
	const canSubmit = parsedAmount !== null && !isOverBalance
	const fillMax = () => onAmountChange(formatAmount(balance))

	return (
		<div className={styles.panel}>
			<h2 className={`${typeStyles.sectionHead} ${styles.heading}`}>
				{heading}
			</h2>
			{note && <p className={`${typeStyles.body} ${styles.note}`}>{note}</p>}
			{blockedReason ? (
				<p className={`${typeStyles.body} ${styles.blocked}`}>
					{blockedReason}
				</p>
			) : (
				<>
					<div className={styles.tabs} role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={side === "subscribe"}
							className={`${styles.tab} ${
								side === "subscribe" ? styles.tabActive : ""
							}`}
							onClick={() => onSideChange("subscribe")}
						>
							Subscribe
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={side === "redeem"}
							className={`${styles.tab} ${
								side === "redeem" ? styles.tabActive : ""
							}`}
							onClick={() => onSideChange("redeem")}
						>
							Redeem
						</button>
					</div>

					<div className={isOverBalance ? styles.fieldOver : styles.field}>
						<div className={styles.amountRow}>
							<label htmlFor="action-panel-amount" className={styles.srOnly}>
								{amountLabel}
							</label>
							<input
								id="action-panel-amount"
								className={`${typeStyles.amountInput} ${styles.amountInput}`}
								value={amount}
								onChange={(event) => onAmountChange(event.target.value)}
								placeholder="0.00"
								inputMode="decimal"
							/>
							<span className={styles.ticker}>{ticker}</span>
							<button
								type="button"
								className={styles.maxButton}
								onClick={fillMax}
							>
								MAX
							</button>
						</div>
						<div className={styles.balanceRow}>
							<span className={`${typeStyles.footnote} ${styles.balanceLabel}`}>
								{balanceLabel}
							</span>
						</div>
					</div>

					<div className={styles.estimate}>
						<span className={`${typeStyles.label} ${styles.estimateLabel}`}>
							{estimate.label}
						</span>
						<span className={`${typeStyles.estimate} ${styles.estimateValue}`}>
							{estimate.value ?? "Estimate unavailable"}
						</span>
						{estimate.note && (
							<span className={`${typeStyles.body} ${styles.estimateNote}`}>
								{estimate.note}
							</span>
						)}
					</div>

					{isOverBalance && (
						<p className={`${typeStyles.body} ${styles.errorMessage}`}>
							{`You have ${formatAmount(balance)} ${ticker}. Enter ${formatAmount(balance)} or less.`}
						</p>
					)}

					<div className={styles.actions}>
						{isOverBalance ? (
							<>
								<button
									type="button"
									className={styles.actionPrimary}
									onClick={fillMax}
								>
									{`Use my maximum, ${formatAmount(balance)} ${ticker}`}
								</button>
								<button
									type="button"
									className={styles.actionUnavailable}
									disabled
								>
									{submitLabel}
								</button>
							</>
						) : (
							<button
								type="button"
								className={
									canSubmit ? styles.actionPrimary : styles.actionUnavailable
								}
								disabled={!canSubmit}
								onClick={onSubmit}
							>
								{canSubmit && parsedAmount !== null
									? `${submitLabel} · ${formatAmount(parsedAmount)} ${ticker}`
									: "Enter an amount"}
							</button>
						)}
					</div>

					<span className={`${typeStyles.footnote} ${styles.footnote}`}>
						{footnote}
					</span>
				</>
			)}
		</div>
	)
}

export default ActionPanel

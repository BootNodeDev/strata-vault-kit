import { formatAmount } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import styles from "./ActionPanel.module.css"

export type ActionPanelSide = "subscribe" | "redeem"

export type ActionPanelEstimate = {
	label: string
	value: string | null
}

export type ActionBlock = {
	kind: "action"
	reason: string
	label: string
	onPress: () => void
}

export type MessageBlock = {
	kind: "message"
	reason: string
}

export type ActionPanelBlock = ActionBlock | MessageBlock

export type ActionPanelProps = {
	side: ActionPanelSide
	onSideChange: (side: ActionPanelSide) => void
	heading: string
	note?: string
	amount: string
	onAmountChange: (amount: string) => void
	amountLabel: string
	ticker: string
	balance: number | null
	balanceLabel: string
	estimate: ActionPanelEstimate
	submitLabel: string
	onSubmit: () => void
	block?: ActionPanelBlock
}

const parseAmount = (raw: string): number | null => {
	const value = Number(raw.replace(/,/g, ""))
	return Number.isFinite(value) && value > 0 ? value : null
}

const PanelActions: React.FC<{
	block: ActionBlock | undefined
	overBalance: string | undefined
	submitLabel: string
	canSubmit: boolean
	onSubmit: () => void
	onFillMax: () => void
}> = ({ block, overBalance, submitLabel, canSubmit, onSubmit, onFillMax }) => {
	if (block) {
		return (
			<div className={styles.actions}>
				<button
					type="button"
					className={styles.actionPrimary}
					onClick={block.onPress}
				>
					{block.label}
				</button>
			</div>
		)
	}

	if (overBalance !== undefined) {
		return (
			<div className={styles.actions}>
				<button
					type="button"
					className={styles.actionPrimary}
					onClick={onFillMax}
				>
					{`Use ${overBalance}`}
				</button>
				<button type="button" className={styles.actionUnavailable} disabled>
					{submitLabel}
				</button>
			</div>
		)
	}

	return (
		<div className={styles.actions}>
			<button
				type="button"
				className={canSubmit ? styles.actionPrimary : styles.actionUnavailable}
				disabled={!canSubmit}
				onClick={onSubmit}
			>
				{submitLabel}
			</button>
		</div>
	)
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
	block,
}) => {
	const parsedAmount = parseAmount(amount)
	const isOverBalance =
		parsedAmount !== null && balance !== null && parsedAmount > balance
	const canSubmit = parsedAmount !== null && !isOverBalance
	const overBalance =
		isOverBalance && balance !== null ? formatAmount(balance) : undefined
	const fillMax = () => {
		if (balance !== null) onAmountChange(formatAmount(balance))
	}
	const actionBlock = block?.kind === "action" ? block : undefined

	return (
		<div className={styles.panel}>
			<h2 className={`${typeStyles.sectionHead} ${styles.heading}`}>
				{heading}
			</h2>
			{note && <p className={`${typeStyles.body} ${styles.note}`}>{note}</p>}
			{block?.kind === "message" ? (
				<p className={`${typeStyles.body} ${styles.blocked}`}>{block.reason}</p>
			) : (
				<>
					{actionBlock && (
						<p className={`${typeStyles.body} ${styles.blocked}`}>
							{actionBlock.reason}
						</p>
					)}

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
							{balance !== null && (
								<button
									type="button"
									className={styles.maxButton}
									onClick={fillMax}
								>
									MAX
								</button>
							)}
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
						<span
							className={`${
								estimate.value === null ? typeStyles.body : typeStyles.estimate
							} ${styles.estimateValue}`}
						>
							{estimate.value ?? "Estimate unavailable"}
						</span>
					</div>

					{overBalance !== undefined && (
						<p className={`${typeStyles.body} ${styles.errorMessage}`}>
							{`You have ${overBalance} ${ticker}. Enter ${overBalance} or less.`}
						</p>
					)}

					<PanelActions
						block={actionBlock}
						overBalance={overBalance}
						submitLabel={submitLabel}
						canSubmit={canSubmit}
						onSubmit={onSubmit}
						onFillMax={fillMax}
					/>
				</>
			)}
		</div>
	)
}

export default ActionPanel

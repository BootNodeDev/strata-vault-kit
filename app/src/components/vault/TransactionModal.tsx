import { explorerTransaction, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import Close from "../icons/Close"
import ExternalLink from "../icons/ExternalLink"
import { describeStatus } from "./transactionModal/content"
import {
	STEP_ORDER,
	stepLabel,
	computeSteps,
	stepStateClassName,
	stepAnnouncement,
} from "./transactionModal/steps"
import { type TransactionModalProps } from "./transactionModal/types"
import styles from "./TransactionModal.module.css"

export type {
	AdminModalAction,
	ComplianceModalAction,
	ConfigurationModalAction,
	EmergencyModalAction,
	GovernanceModalAction,
	TransactionModalProps,
} from "./transactionModal/types"
export { ADMIN_VERBS } from "./transactionModal/content"
export { HELD_WHILE_FROZEN, NOT_ALLOWLISTED } from "./transactionModal/investor"

export const ShareLink: React.FC<{ xdr: string }> = ({ xdr }) => {
	const [copied, setCopied] = React.useState(false)
	const link = `${window.location.origin}/sign#${xdr}`

	React.useEffect(() => {
		if (!copied) return
		const timer = setTimeout(() => setCopied(false), 2000)
		return () => clearTimeout(timer)
	}, [copied])

	return (
		<div className={styles.link}>
			<input
				className={`${typeStyles.railValue} ${styles.linkInput}`}
				type="text"
				readOnly
				value={link}
				aria-label="Signing link"
				onFocus={(event) => event.currentTarget.select()}
			/>
			<button
				type="button"
				className={styles.retry}
				onClick={() => {
					void navigator.clipboard.writeText(link).then(
						() => setCopied(true),
						() => setCopied(false),
					)
				}}
			>
				{copied ? "Copied" : "Copy link"}
			</button>
		</div>
	)
}

const TransactionModal: React.FC<TransactionModalProps> = (props) => {
	const { status, onClose, onRetry } = props
	const dialogRef = React.useRef<HTMLDialogElement>(null)

	React.useEffect(() => {
		if (dialogRef.current !== null && !dialogRef.current.open) {
			dialogRef.current.showModal()
		}
	}, [])

	const contractErrorCode =
		status.status === "failed" && status.failure.kind === "contract-error"
			? status.failure.code
			: undefined

	React.useEffect(() => {
		if (contractErrorCode !== undefined) {
			console.error(`Contract error ${contractErrorCode}`)
		}
	}, [contractErrorCode])

	const content = describeStatus(props)
	if (content === undefined) return null

	const steps = computeSteps(status)
	const isConfirmed = status.status === "confirmed"
	const explorer =
		content.hash === undefined ? null : explorerTransaction(content.hash)
	const offersRetry =
		status.status === "failed" &&
		(status.failure.kind === "declined" ||
			status.failure.kind === "unsigned" ||
			status.failure.kind === "stale")
	const headingId = "transaction-modal-heading"

	const headingClassName = isConfirmed
		? `${typeStyles.vaultName} ${styles.heading} ${styles.headingConfirmed}`
		: `${typeStyles.sectionHead} ${styles.heading}`

	const body = (
		<>
			<h2 id={headingId} className={headingClassName}>
				{content.heading}
			</h2>
			<p className={`${typeStyles.body} ${styles.body}`}>{content.body}</p>
			{content.hash !== undefined && (
				<p className={`${typeStyles.railValue} ${styles.hash}`}>
					Transaction{" "}
					{explorer === null ? (
						shortAddress(content.hash)
					) : (
						<a
							className={styles.hashLink}
							href={explorer}
							target="_blank"
							rel="noreferrer"
						>
							{shortAddress(content.hash)}
							<ExternalLink className={styles.hashIcon} />
						</a>
					)}
				</p>
			)}
		</>
	)

	return (
		<dialog
			ref={dialogRef}
			aria-modal="true"
			aria-labelledby={headingId}
			className={styles.dialog}
			onCancel={onClose}
		>
			<button
				type="button"
				className={styles.close}
				aria-label="Close"
				onClick={onClose}
			>
				<Close className={styles.closeIcon} />
			</button>
			{steps !== undefined && (
				<ol className={styles.steps} aria-label="Transaction progress">
					{STEP_ORDER.map((id) => {
						const state = steps[id]
						const announcement = stepAnnouncement[state]
						return (
							<li
								key={id}
								className={`${styles.step} ${stepStateClassName[state]}`}
								aria-current={state === "current" ? "step" : undefined}
							>
								<span className={styles.stepMarker} aria-hidden="true" />
								<span className={`${typeStyles.footnote} ${styles.stepLabel}`}>
									{stepLabel[id]}
									{announcement !== undefined && (
										<span className={styles.srOnly}>, {announcement}</span>
									)}
								</span>
							</li>
						)
					})}
				</ol>
			)}
			{isConfirmed ? (
				<div className={styles.arrival} role="status">
					{body}
				</div>
			) : (
				body
			)}
			{status.status === "shared" && <ShareLink xdr={status.xdr} />}
			{offersRetry && (
				<div className={styles.actions}>
					<button type="button" className={styles.retry} onClick={onRetry}>
						Try again
					</button>
				</div>
			)}
		</dialog>
	)
}

export default TransactionModal

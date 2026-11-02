import { explorerTransaction, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import typeStyles from "../../styles/type.module.css"
import Close from "../icons/Close"
import ExternalLink from "../icons/ExternalLink"
import { describeTransaction } from "./transactionCopy"
import { type TransactionModalProps } from "./transactionCopy/types"
import styles from "./TransactionModal.module.css"

export { ADMIN_VERBS } from "./transactionCopy/admin"
export type {
	AdminModalAction,
	ComplianceModalAction,
	ConfigurationModalAction,
	EmergencyModalAction,
	GovernanceModalAction,
	TransactionModalProps,
} from "./transactionCopy/types"

type StepId = "signature" | "network" | "recorded"
type StepState = "done" | "current" | "upcoming" | "failed"

const STEP_ORDER: StepId[] = ["signature", "network", "recorded"]

const stepLabel: Record<StepId, string> = {
	signature: "Approved in your wallet",
	network: "Sent to the network",
	recorded: "Recorded",
}

const computeSteps = (
	status: TransactionModalProps["status"],
): Record<StepId, StepState> | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				signature: "upcoming",
				network: "upcoming",
				recorded: "upcoming",
			}
		case "awaiting-signature":
			return { signature: "current", network: "upcoming", recorded: "upcoming" }
		case "submitted":
			return { signature: "done", network: "current", recorded: "upcoming" }
		case "shared":
			return { signature: "done", network: "upcoming", recorded: "upcoming" }
		case "confirmed":
			return { signature: "done", network: "done", recorded: "done" }
		case "failed":
			if (status.failure.kind === "unknown" && status.hash !== undefined) {
				return { signature: "done", network: "done", recorded: "failed" }
			}
			if (
				status.failure.kind === "unknown" ||
				status.failure.kind === "network" ||
				status.failure.kind === "stale"
			) {
				return { signature: "done", network: "failed", recorded: "upcoming" }
			}
			return { signature: "failed", network: "upcoming", recorded: "upcoming" }
	}
}

const stepStateClassName: Record<StepState, string | undefined> = {
	done: styles.stepDone,
	current: styles.stepCurrent,
	failed: styles.stepFailed,
	upcoming: styles.stepUpcoming,
}

const stepAnnouncement: Partial<Record<StepState, string>> = {
	done: "done",
	current: "in progress",
	failed: "failed",
}

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

	const content = describeTransaction(props)
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

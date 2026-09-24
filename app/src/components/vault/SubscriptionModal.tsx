import { shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import {
	type RequestDepositFailure,
	type RequestDepositStatus,
} from "../../hooks/useRequestDeposit"
import typeStyles from "../../styles/type.module.css"
import styles from "./SubscriptionModal.module.css"

export type SubscriptionModalProps = {
	status: RequestDepositStatus
	amount: string
	ticker: string
	onClose: () => void
	onRetry: () => void
}

const contractErrorReason = (code: number): string => {
	switch (code) {
		case 6007:
			return "Enter an amount greater than zero."
		case 6009:
			return "You already have a subscription request open in this batch."
		case 6014:
			return "That amount is too large for this batch to hold."
		case 6046:
			return "The vault is winding down and is not accepting new subscriptions."
		default:
			return `The vault declined this request (reason ${code}).`
	}
}

const describeFailure = (
	failure: RequestDepositFailure,
): { heading: string; body: string } => {
	switch (failure.kind) {
		case "declined":
			return {
				heading: "You declined the request",
				body: "You chose not to sign, so nothing was sent. Try again when you're ready.",
			}
		case "contract-error":
			return {
				heading: "The vault refused this request",
				body: contractErrorReason(failure.code),
			}
		case "unknown":
			return {
				heading: "Something went wrong",
				body: "We could not confirm whether this reached the network. Check your requests before doing anything else — we don't yet know if it went through.",
			}
	}
}

const describeStatus = (
	status: RequestDepositStatus,
	amount: string,
	ticker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `This request moves ${amount} ${ticker} into escrow. Nothing is exchanged today — your shares are set once this batch is priced.`,
			}
		case "submitted":
			return {
				heading: "Sending your request",
				body: "Your request is on its way to the network. This should only take a moment — pricing comes later and takes longer. Closing this window will not cancel it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Request locked in",
				body: `${amount} ${ticker} is now locked in escrow for Epoch ${status.epochId}. It prices at the next attestation.`,
				hash: status.hash,
			}
		case "failed":
			return { ...describeFailure(status.failure), hash: status.hash }
	}
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
	status,
	amount,
	ticker,
	onClose,
	onRetry,
}) => {
	const dialogRef = React.useRef<HTMLDivElement>(null)

	React.useEffect(() => {
		dialogRef.current?.focus()
	}, [])

	const content = describeStatus(status, amount, ticker)
	if (content === undefined) return null

	const offersRetry =
		status.status === "failed" && status.failure.kind === "declined"
	const headingId = "subscription-modal-heading"

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault()
			onClose()
		}
	}

	return (
		<div className={styles.overlay}>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				tabIndex={-1}
				className={styles.dialog}
				onKeyDown={onKeyDown}
			>
				<button
					type="button"
					className={styles.close}
					aria-label="Close"
					onClick={onClose}
				>
					Close
				</button>
				<h2
					id={headingId}
					className={`${typeStyles.sectionHead} ${styles.heading}`}
				>
					{content.heading}
				</h2>
				<p className={`${typeStyles.body} ${styles.body}`}>{content.body}</p>
				{content.hash !== undefined && (
					<p className={`${typeStyles.railValue} ${styles.hash}`}>
						Transaction {shortAddress(content.hash)}
					</p>
				)}
				{offersRetry && (
					<div className={styles.actions}>
						<button type="button" className={styles.retry} onClick={onRetry}>
							Try again
						</button>
					</div>
				)}
			</div>
		</div>
	)
}

export default SubscriptionModal

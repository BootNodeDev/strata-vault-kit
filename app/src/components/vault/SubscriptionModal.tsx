import { explorerTransaction, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import {
	type CancelDepositFailure,
	type CancelDepositStatus,
} from "../../hooks/useCancelDeposit"
import {
	type RequestDepositFailure,
	type RequestDepositStatus,
} from "../../hooks/useRequestDeposit"
import typeStyles from "../../styles/type.module.css"
import Close from "../icons/Close"
import ExternalLink from "../icons/ExternalLink"
import styles from "./SubscriptionModal.module.css"

export type SubscriptionModalProps =
	| {
			action: "subscribe"
			status: RequestDepositStatus
			amount: string
			ticker: string
			onClose: () => void
			onRetry: () => void
	  }
	| {
			action: "cancel"
			status: CancelDepositStatus
			amount: string
			ticker: string
			onClose: () => void
			onRetry: () => void
	  }

const subscribeContractErrorReason = (code: number): string => {
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

const cancelContractErrorReason = (code: number): string => {
	switch (code) {
		case 6001:
			return "This request no longer exists to cancel."
		case 6029:
			return "This batch could not be found."
		case 6039:
			return "This batch has already been priced. Claim your shares instead of cancelling."
		case 6041:
			return "A price is now available for this batch. Claim your shares instead of cancelling."
		default:
			return `The vault declined this request (reason ${code}).`
	}
}

const describeFailure = (
	failure: RequestDepositFailure | CancelDepositFailure,
	contractErrorReason: (code: number) => string,
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
		case "interrupted":
			return {
				heading: "We couldn't reach the vault",
				body: "Nothing was requested from your wallet. Try again when you're ready.",
			}
		case "unknown":
			return {
				heading: "Something went wrong",
				body: "We could not confirm whether this reached the network. We don't yet know if it went through, so check your requests before doing anything else.",
			}
	}
}

const describeSubscribeStatus = (
	status: RequestDepositStatus,
	amount: string,
	ticker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your request",
				body: "We are getting your request ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `This request moves ${amount} ${ticker} into escrow. Nothing is exchanged today, and your shares are set once this batch is priced.`,
			}
		case "submitted":
			return {
				heading: "Sending your request",
				body: "Your request is on its way to the network. This should only take a moment, while pricing comes later and takes longer. Closing this window will not cancel it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Request locked in",
				body: `${amount} ${ticker} is now locked in escrow for Batch ${status.epochId}. It prices at the next attestation.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(status.failure, subscribeContractErrorReason),
				hash: status.hash,
			}
	}
}

const describeCancelStatus = (
	status: CancelDepositStatus,
	amount: string,
	ticker: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: "Preparing your cancellation",
				body: "We are getting your cancellation ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return {
				heading: "Confirm in your wallet",
				body: `This returns ${amount} ${ticker} from escrow to your wallet. This request is withdrawn, not priced.`,
			}
		case "submitted":
			return {
				heading: "Sending your cancellation",
				body: "Your cancellation is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "confirmed":
			return {
				heading: "Request cancelled",
				body: `${amount} ${ticker} has been returned to your wallet.`,
				hash: status.hash,
			}
		case "failed":
			return {
				...describeFailure(status.failure, cancelContractErrorReason),
				hash: status.hash,
			}
	}
}

const describeStatus = (
	props: SubscriptionModalProps,
): { heading: string; body: string; hash?: string } | undefined =>
	props.action === "subscribe"
		? describeSubscribeStatus(props.status, props.amount, props.ticker)
		: describeCancelStatus(props.status, props.amount, props.ticker)

type StepId = "signature" | "network" | "recorded"
type StepState = "done" | "current" | "upcoming" | "failed"

const STEP_ORDER: StepId[] = ["signature", "network", "recorded"]

const stepLabel: Record<StepId, string> = {
	signature: "Approved in your wallet",
	network: "Sent to the network",
	recorded: "Recorded",
}

const computeSteps = (
	status: RequestDepositStatus | CancelDepositStatus,
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
		case "confirmed":
			return { signature: "done", network: "done", recorded: "done" }
		case "failed":
			if (status.failure.kind === "unknown" && status.hash !== undefined) {
				return { signature: "done", network: "done", recorded: "failed" }
			}
			if (status.failure.kind === "unknown") {
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

const SubscriptionModal: React.FC<SubscriptionModalProps> = (props) => {
	const { status, onClose, onRetry } = props
	const dialogRef = React.useRef<HTMLDivElement>(null)

	React.useEffect(() => {
		dialogRef.current?.focus()
	}, [])

	const content = describeStatus(props)
	if (content === undefined) return null

	const steps = computeSteps(status)
	const isConfirmed = status.status === "confirmed"
	const explorer =
		content.hash === undefined ? null : explorerTransaction(content.hash)
	const offersRetry =
		status.status === "failed" && status.failure.kind === "declined"
	const headingId = "subscription-modal-heading"

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault()
			onClose()
		}
	}

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
					<Close className={styles.closeIcon} />
				</button>
				{steps !== undefined && (
					<ol className={styles.steps} aria-label="Subscription progress">
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
									<span
										className={`${typeStyles.footnote} ${styles.stepLabel}`}
									>
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

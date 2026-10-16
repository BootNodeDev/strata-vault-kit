import { type AccountSigners, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import { useLocation } from "react-router-dom"
import railStyles from "../components/admin/CycleActionRail.module.css"
import TransactionModal, {
	ShareLink,
} from "../components/vault/TransactionModal"
import { useSignPending } from "../hooks/useSignPending"
import { useWallet } from "../hooks/useWallet"
import typeStyles from "../styles/type.module.css"
import {
	describeCollected,
	describeExpiry,
	primaryAction,
	type SignArg,
	STATE_COPY,
	STATE_VIEW,
	toModalProps,
	uniformWeights,
} from "./sign"
import styles from "./SignPage.module.css"

const INVALID = "This link does not carry a valid transaction."

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div className={styles.page}>
		<section className={styles.card}>{children}</section>
	</div>
)

const Tile: React.FC<{ label: string; children: React.ReactNode }> = ({
	label,
	children,
}) => (
	<div className={styles.tile}>
		<dt className={`${typeStyles.footnote} ${styles.tileLabel}`}>{label}</dt>
		<dd className={`${typeStyles.railValue} ${styles.tileValue}`}>
			{children}
		</dd>
	</div>
)

const SignedIcon: React.FC = () => (
	<span className={railStyles.pass} aria-hidden="true">
		<svg viewBox="0 0 16 16" className={railStyles.icon}>
			<path d="M3 8.5l3 3 7-7" />
		</svg>
	</span>
)

const PendingIcon: React.FC = () => (
	<span className={railStyles.pending} aria-hidden="true">
		<span className={railStyles.dot} />
	</span>
)

const Progress: React.FC<{ weight: number; threshold: number }> = ({
	weight,
	threshold,
}) => {
	const filled = Math.min(weight, threshold)
	return (
		<div
			role="progressbar"
			aria-label="Signatures collected"
			aria-valuemin={0}
			aria-valuemax={threshold}
			aria-valuenow={filled}
			className={styles.bar}
		>
			{Array.from({ length: threshold }, (_, index) => (
				<span
					key={index}
					className={index < filled ? styles.segmentFilled : styles.segment}
				/>
			))}
		</div>
	)
}

type SignaturesProps = {
	signers: AccountSigners | null | undefined
	weight: number
	signedBy: string[]
	wallet: string | undefined
}

const Signatures: React.FC<SignaturesProps> = ({
	signers,
	weight,
	signedBy,
	wallet,
}) => {
	if (!signers) {
		return (
			<section className={styles.signatures}>
				<p className={`${typeStyles.sectionHead} ${styles.caption}`}>
					{signers === null ? "Signatures unavailable" : "Checking signatures"}
				</p>
			</section>
		)
	}
	const uniform = uniformWeights(signers)
	return (
		<section className={styles.signatures}>
			<p className={`${typeStyles.sectionHead} ${styles.caption}`}>
				{describeCollected(weight, signers)}
			</p>
			<Progress weight={weight} threshold={signers.thresholds.med} />
			<ul className={styles.signers} aria-label="Signers">
				{signers.signers.map(({ key, weight: own }) => {
					const signed = signedBy.includes(key)
					return (
						<li key={key} className={`${typeStyles.footnote} ${styles.signer}`}>
							{signed ? <SignedIcon /> : <PendingIcon />}
							<span className={`${typeStyles.railValue} ${styles.signerKey}`}>
								{shortAddress(key)}
							</span>
							{!uniform && (
								<span className={styles.signerMeta}>weight {own}</span>
							)}
							{key === wallet && (
								<span className={`${typeStyles.label} ${styles.you}`}>you</span>
							)}
							<span className={signed ? styles.signed : styles.signerMeta}>
								{signed ? "signed" : "pending"}
							</span>
						</li>
					)
				})}
			</ul>
		</section>
	)
}

type DetailsProps = {
	source: string
	contractId: string
	expiresAt: Date | null
	args: SignArg[]
}

const Details: React.FC<DetailsProps> = ({
	source,
	contractId,
	expiresAt,
	args,
}) => (
	<dl className={styles.tiles}>
		<Tile label="Account">{shortAddress(source)}</Tile>
		<Tile label="Contract">{shortAddress(contractId)}</Tile>
		<Tile label="Expires">{describeExpiry(expiresAt)}</Tile>
		{args.map((arg) => (
			<Tile key={arg.label} label={arg.label}>
				{arg.value}
			</Tile>
		))}
	</dl>
)

const PendingSign: React.FC<{ xdr: string }> = ({ xdr }) => {
	const { address } = useWallet()
	const sign = useSignPending(xdr)
	const { pending, description, signers } = sign
	if (pending === null || description === null) {
		return (
			<Card>
				<p className={`${typeStyles.body} ${styles.invalid}`}>{INVALID}</p>
			</Card>
		)
	}
	const view = STATE_VIEW[sign.state]
	const action = primaryAction(sign.state, address !== undefined, sign.canSign)
	const onAction = sign.state === "ready" ? sign.submit : sign.sign

	return (
		<Card>
			<header className={styles.heading}>
				<p className={`${typeStyles.label} ${styles.contract}`}>
					{description.contract}
				</p>
				<div className={styles.titleRow}>
					<h1 className={`${typeStyles.vaultName} ${styles.title}`}>
						{description.label}
					</h1>
					<span
						role="status"
						aria-label={STATE_COPY[sign.state]}
						data-tone={view.tone}
						className={`${typeStyles.label} ${styles.pill}`}
					>
						{view.pill}
					</span>
				</div>
			</header>
			<Signatures
				signers={signers}
				weight={sign.weight}
				signedBy={sign.signedBy}
				wallet={address}
			/>
			<Details
				source={pending.source}
				contractId={pending.contractId}
				expiresAt={pending.expiresAt}
				args={description.args}
			/>
			<div className={styles.actions}>
				{action && (
					<button
						type="button"
						className={
							action.enabled ? styles.actionPrimary : styles.actionUnavailable
						}
						disabled={!action.enabled}
						onClick={onAction}
					>
						{action.label}
					</button>
				)}
				<div className={styles.nextStep}>
					<p className={`${typeStyles.label} ${styles.nextStepLabel}`}>
						Next step
					</p>
					<p className={`${typeStyles.body} ${styles.nextStepText}`}>
						{view.nextStep}
					</p>
					{view.shareable && <ShareLink xdr={sign.xdr} />}
				</div>
			</div>
			{sign.status.status !== "idle" && (
				<TransactionModal
					{...toModalProps(description, sign.status, {
						onClose: sign.reset,
						onRetry: sign.sign,
					})}
				/>
			)}
		</Card>
	)
}

const SignPage: React.FC = () => {
	const { hash } = useLocation()
	const xdr = hash.slice(1)
	return <PendingSign key={xdr} xdr={xdr} />
}

export default SignPage

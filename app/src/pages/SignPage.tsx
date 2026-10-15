import { formatDate, shortAddress } from "@stellar-scaffold/app-lib"
import React from "react"
import { useLocation } from "react-router-dom"
import TransactionModal, {
	ShareLink,
} from "../components/vault/TransactionModal"
import { useSignPending } from "../hooks/useSignPending"
import { useWallet } from "../hooks/useWallet"
import typeStyles from "../styles/type.module.css"
import { describeCollected, STATE_COPY, toModalProps } from "./sign"
import styles from "./SignPage.module.css"

const INVALID = "This link does not carry a valid transaction."

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({
	label,
	children,
}) => (
	<div className={styles.fact}>
		<dt className={`${typeStyles.footnote} ${styles.factLabel}`}>{label}</dt>
		<dd className={`${typeStyles.railValue} ${styles.factValue}`}>
			{children}
		</dd>
	</div>
)

const describeExpiry = (expiresAt: Date | null): string =>
	expiresAt === null
		? "No expiry"
		: formatDate(BigInt(Math.floor(expiresAt.getTime() / 1000)))

const PendingSign: React.FC<{ xdr: string }> = ({ xdr }) => {
	const { address } = useWallet()
	const sign = useSignPending(xdr)
	const { pending, description, signers } = sign
	if (pending === null || description === null) {
		return <p className={`${typeStyles.body} ${styles.invalid}`}>{INVALID}</p>
	}
	const buttonClass = (enabled: boolean) =>
		enabled ? styles.actionPrimary : styles.actionUnavailable

	return (
		<div className={styles.page}>
			<header className={styles.heading}>
				<p className={`${typeStyles.label} ${styles.contract}`}>
					{description.contract}
				</p>
				<h1 className={`${typeStyles.vaultName} ${styles.title}`}>
					{description.label}
				</h1>
				<p className={`${typeStyles.body} ${styles.state}`} role="status">
					{STATE_COPY[sign.state]}
				</p>
			</header>
			<dl className={styles.facts}>
				{description.args.map((arg) => (
					<Fact key={arg.label} label={arg.label}>
						{arg.value}
					</Fact>
				))}
				<Fact label="Account">{shortAddress(pending.source)}</Fact>
				<Fact label="Contract">{shortAddress(pending.contractId)}</Fact>
				<Fact label="Expires">{describeExpiry(pending.expiresAt)}</Fact>
				<Fact label="Signatures">
					{signers
						? describeCollected(sign.weight, signers)
						: signers === null
							? "Unavailable"
							: "Checking"}
				</Fact>
				{signers && (
					<Fact label="Signers">
						<ul className={styles.signers}>
							{signers.signers.map(({ key }) => (
								<li key={key}>
									{shortAddress(key)}
									{sign.signedBy.includes(key) && (
										<span className={styles.signed}> signed</span>
									)}
								</li>
							))}
						</ul>
					</Fact>
				)}
			</dl>
			<div className={styles.actions}>
				<button
					type="button"
					className={buttonClass(sign.canSign)}
					disabled={!sign.canSign}
					onClick={sign.sign}
				>
					{address === undefined ? "Connect a wallet to sign" : "Sign"}
				</button>
				<button
					type="button"
					className={buttonClass(sign.canSubmit)}
					disabled={!sign.canSubmit}
					onClick={sign.submit}
				>
					Submit
				</button>
			</div>
			<ShareLink xdr={sign.xdr} />
			{sign.status.status !== "idle" && (
				<TransactionModal
					{...toModalProps(description, sign.status, {
						onClose: sign.reset,
						onRetry: sign.sign,
					})}
				/>
			)}
		</div>
	)
}

const SignPage: React.FC = () => {
	const { hash } = useLocation()
	const xdr = hash.slice(1)
	return <PendingSign key={xdr} xdr={xdr} />
}

export default SignPage

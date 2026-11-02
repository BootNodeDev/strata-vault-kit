import { type AdminCopy, describeAdminStatus } from "./adminCopy"
import { COMPLIANCE_FOLLOW_UP, COMPLIANCE_COPY } from "./compliance"
import { CONFIGURATION_FOLLOW_UP, CONFIGURATION_COPY } from "./configuration"
import {
	describeCloseEpochStatus,
	describeFulfillEpochStatus,
	describeAttestStatus,
	describeDeployStatus,
	describeFundStatus,
	describeActivateWindDownStatus,
	describeFinalizeRoundStatus,
} from "./cycle"
import { EMERGENCY_FOLLOW_UP, EMERGENCY_COPY } from "./emergency"
import { GOVERNANCE_FOLLOW_UP, GOVERNANCE_COPY } from "./governance"
import {
	describeSubscribeStatus,
	describeCancelStatus,
	describeCancelRedeemStatus,
	describeClaimStatus,
	describeClaimWindDownStatus,
	describeRedeemStatus,
	describeClaimRedeemStatus,
} from "./investor"
import { type AdminModalAction, type TransactionModalProps } from "./types"

const verbsOf = <Id extends string>(
	table: Record<Id, AdminCopy | ((value: string) => AdminCopy)>,
): Record<Id, string> =>
	Object.fromEntries(
		Object.entries<AdminCopy | ((value: string) => AdminCopy)>(table).map(
			([id, copy]) => [id, (typeof copy === "function" ? copy("") : copy).verb],
		),
	) as Record<Id, string>

export const ADMIN_VERBS: Record<AdminModalAction, string> = {
	...verbsOf(EMERGENCY_COPY),
	...verbsOf(CONFIGURATION_COPY),
	...verbsOf(GOVERNANCE_COPY),
	...verbsOf(COMPLIANCE_COPY),
}

export const describeStatus = (
	props: TransactionModalProps,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (props.action) {
		case "subscribe":
			return describeSubscribeStatus(props.status, props.amount, props.ticker)
		case "cancel":
			return describeCancelStatus(props.status, props.amount, props.ticker)
		case "cancel-redeem":
			return describeCancelRedeemStatus(
				props.status,
				props.amount,
				props.ticker,
				props.assetTicker,
				props.windingDown === true,
			)
		case "claim":
			return describeClaimStatus(
				props.status,
				props.amount,
				props.ticker,
				props.shareTicker,
			)
		case "redeem":
			return describeRedeemStatus(props.status, props.amount, props.ticker)
		case "claim-redeem":
			return describeClaimRedeemStatus(
				props.status,
				props.amount,
				props.ticker,
				props.uncovered,
			)
		case "claim-wind-down":
			return describeClaimWindDownStatus(
				props.status,
				props.amount,
				props.ticker,
				props.shareTicker,
			)
		case "close-epoch":
			return describeCloseEpochStatus(props.status, props.epoch)
		case "fulfill-epoch":
			return describeFulfillEpochStatus(props.status, props.epoch)
		case "attest":
			return describeAttestStatus(props.status, props.price, props.validFor)
		case "deploy":
			return describeDeployStatus(props.status, props.amount)
		case "fund":
			return describeFundStatus(props.status, props.amount)
		case "activate-wind-down":
			return describeActivateWindDownStatus(props.status)
		case "finalize-round":
			return describeFinalizeRoundStatus(props.status, props.round)
		case "pause-vault":
		case "unpause-vault":
		case "pause-nav":
		case "unpause-nav":
		case "clear-latest":
		case "pause-token":
		case "unpause-token":
			return describeAdminStatus(
				EMERGENCY_COPY[props.action],
				props.status,
				EMERGENCY_FOLLOW_UP,
			)
		case "set-deposit-cap":
		case "set-custodian":
		case "set-notice":
		case "set-wind-down-delay":
		case "set-min-epoch-duration":
		case "propose-custodian":
		case "propose-notice":
		case "propose-wind-down-delay":
		case "propose-min-epoch-duration":
		case "set-oracle-config":
		case "propose-oracle-config":
		case "set-compliance":
		case "propose-compliance":
		case "set-identity-verifier":
		case "propose-identity-verifier":
			return describeAdminStatus(
				CONFIGURATION_COPY[props.action](props.value),
				props.status,
				CONFIGURATION_FOLLOW_UP,
			)
		case "grant-vault-role":
		case "revoke-vault-role":
		case "grant-oracle-role":
		case "revoke-oracle-role":
		case "grant-token-role":
		case "revoke-token-role":
		case "hand-over-vault-admin":
		case "cancel-vault-handover":
		case "accept-vault-admin":
		case "hand-over-oracle-admin":
		case "cancel-oracle-handover":
		case "accept-oracle-admin":
		case "hand-over-token-admin":
		case "cancel-token-handover":
		case "accept-token-admin":
		case "propose-grant-role":
		case "propose-revoke-role":
		case "propose-admin":
		case "propose-token-grant-role":
		case "propose-token-revoke-role":
		case "propose-token-admin":
		case "propose-code-upgrade":
		case "propose-upgrade-delay":
		case "apply-change":
		case "cancel-change":
		case "apply-token-change":
		case "cancel-token-change":
		case "propose-oracle-grant-role":
		case "propose-oracle-revoke-role":
		case "propose-oracle-admin":
		case "propose-oracle-upgrade":
		case "apply-oracle-change":
		case "cancel-oracle-change":
		case "propose-wind-down":
		case "cancel-wind-down":
			return describeAdminStatus(
				GOVERNANCE_COPY[props.action](props.value),
				props.status,
				GOVERNANCE_FOLLOW_UP,
			)
		case "allow-address":
		case "disallow-address":
		case "freeze-address":
		case "unfreeze-address":
		case "freeze-shares":
		case "unfreeze-shares":
		case "legal-transfer":
			return describeAdminStatus(
				COMPLIANCE_COPY[props.action](props.value),
				props.status,
				COMPLIANCE_FOLLOW_UP,
			)
	}
}

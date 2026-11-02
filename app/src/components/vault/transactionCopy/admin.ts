import { formatDate } from "@stellar-scaffold/app-lib"
import { type SharedTransaction } from "../../../hooks/useContractTransaction"
import { describeStanding } from "../../../pages/actions"
import { EFFECTS } from "../../../pages/configuration"
import {
	type AdminModalAction,
	type ComplianceModalAction,
	type ConfigurationModalAction,
	type Copy,
	type EmergencyModalAction,
	type GovernanceModalAction,
	type Reasons,
	type StatusCopy,
} from "./types"

const EMERGENCY_FOLLOW_UP = "check the Emergency tab before trying again"
const CONFIGURATION_FOLLOW_UP =
	"check the Configuration tab before trying again"
const GOVERNANCE_FOLLOW_UP = "check the Governance tab before trying again"
const COMPLIANCE_FOLLOW_UP = "check the Compliance tab before trying again"

type Refuser = "vault" | "share token" | "oracle" | "identity verifier"

type AdminCopy = {
	refuser: Refuser
	reasons?: Reasons
	verb: string
	signing: string
	done: string
	doneBody: string
}

const EMERGENCY_COPY: Record<EmergencyModalAction, AdminCopy> = {
	"pause-vault": {
		refuser: "vault",
		verb: "pause the vault",
		signing: "Signing stops new deposits, pricing and upgrades.",
		done: "Vault paused",
		doneBody:
			"New deposits, pricing and upgrades are stopped. Redemptions, claims, cancels and closing epochs stay open.",
	},
	"unpause-vault": {
		refuser: "vault",
		verb: "unpause the vault",
		signing: "Signing resumes deposits, pricing and upgrades.",
		done: "Vault unpaused",
		doneBody: "Deposits, pricing and upgrades are open again.",
	},
	"pause-nav": {
		refuser: "oracle",
		verb: "pause the NAV",
		signing: "Signing stops pricing until the NAV is unpaused.",
		done: "NAV paused",
		doneBody:
			"Pricing is stopped. No epoch can be fulfilled until the NAV is unpaused.",
	},
	"unpause-nav": {
		refuser: "oracle",
		verb: "unpause the NAV",
		signing: "Signing resumes pricing.",
		done: "NAV unpaused",
		doneBody: "Epochs can be fulfilled again while the price is valid.",
	},
	"clear-latest": {
		refuser: "oracle",
		verb: "clear the latest price",
		signing: "Signing removes the recorded price.",
		done: "Latest price cleared",
		doneBody:
			"The next attestation is not limited by its distance from the last. Pricing stays stopped until the NAV is unpaused.",
	},
	"pause-token": {
		refuser: "share token",
		verb: "pause the share token",
		signing: "Signing stops holder transfers only.",
		done: "Share token paused",
		doneBody:
			"Holder transfers are stopped. Minting, burning, the vault's escrow moves and legal transfers continue.",
	},
	"unpause-token": {
		refuser: "share token",
		verb: "unpause the share token",
		signing: "Signing resumes holder transfers.",
		done: "Share token unpaused",
		doneBody: "Holder transfers are open again.",
	},
}

const setterCopy =
	(refuser: AdminCopy["refuser"], subject: string, effect?: string) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: `set the ${subject.toLowerCase()}`,
		signing: `New ${subject.toLowerCase()}: ${value}.`,
		done: `${subject} updated`,
		doneBody: effect ?? `${subject}: ${value}.`,
	})

const capitalize = (text: string): string =>
	`${text.charAt(0).toUpperCase()}${text.slice(1)}`

type TimelockRefuser = Extract<
	AdminCopy["refuser"],
	"vault" | "share token" | "oracle"
>

const WAITS: Record<TimelockRefuser, string> = {
	vault: "the upgrade delay",
	"share token": "the vault's upgrade delay",
	oracle: "the vault's upgrade delay",
}

const proposeCopy =
	(refuser: TimelockRefuser, verb: string, subject: string) =>
	(value: string): AdminCopy => ({
		refuser,
		verb,
		signing: `Signing queues ${subject} ${value}.`,
		done: "Change proposed",
		doneBody: `${capitalize(subject)} ${value} applies once ${WAITS[refuser]} passes.`,
	})

const MIN_EPOCH_DURATION_REASONS: Reasons = {
	InvalidAmount: "The minimum epoch duration must be 1 to 30 days.",
}

const CONFIGURATION_COPY: Record<
	ConfigurationModalAction,
	(value: string) => AdminCopy
> = {
	"set-deposit-cap": setterCopy("vault", "Deposit cap"),
	"set-custodian": setterCopy("vault", "Custodian", EFFECTS.custodian),
	"set-notice": setterCopy("vault", "Notice", EFFECTS.notice),
	"set-wind-down-delay": setterCopy(
		"vault",
		"Wind-down delay",
		EFFECTS.windDownDelay,
	),
	"set-min-epoch-duration": (value) => ({
		...setterCopy(
			"vault",
			"Minimum epoch duration",
			EFFECTS.minEpochDuration,
		)(value),
		reasons: MIN_EPOCH_DURATION_REASONS,
	}),
	"propose-custodian": proposeCopy("vault", "propose a custodian", "custodian"),
	"propose-notice": proposeCopy("vault", "propose a notice", "notice"),
	"propose-wind-down-delay": proposeCopy(
		"vault",
		"propose a wind-down delay",
		"wind-down delay",
	),
	"propose-min-epoch-duration": (value) => ({
		...proposeCopy(
			"vault",
			"propose a minimum epoch duration",
			"minimum epoch duration",
		)(value),
		reasons: MIN_EPOCH_DURATION_REASONS,
	}),
	"set-oracle-config": () => ({
		refuser: "oracle",
		verb: "set the oracle limits",
		signing: "Signing replaces every oracle limit.",
		done: "Oracle limits updated",
		doneBody: "The new limits are recorded.",
	}),
	"propose-oracle-config": () => ({
		refuser: "oracle",
		verb: "propose oracle limits",
		signing: "Signing queues every new oracle limit.",
		done: "Change proposed",
		doneBody: `The new oracle limits apply once ${WAITS.oracle} passes.`,
	}),
	"set-compliance": setterCopy("share token", "Compliance contract"),
	"propose-compliance": proposeCopy(
		"share token",
		"propose a compliance contract",
		"compliance contract",
	),
	"set-identity-verifier": setterCopy("share token", "Identity verifier"),
	"propose-identity-verifier": proposeCopy(
		"share token",
		"propose an identity verifier",
		"identity verifier",
	),
}

const grantCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "grant a role",
		signing: `Signing grants ${value}.`,
		done: "Role granted",
		doneBody: `Granted ${value}.`,
	})

const revokeCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "revoke a role",
		signing: `Signing revokes ${value}.`,
		done: "Role revoked",
		doneBody: `Revoked ${value}.`,
	})

const handOverCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "hand over the admin",
		signing: "Signing proposes the handover.",
		done: "Handover proposed",
		doneBody: value,
	})

const cancelHandoverCopy =
	(refuser: AdminCopy["refuser"]) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "cancel the handover",
		signing: `Signing withdraws the offer to ${value}.`,
		done: "Handover cancelled",
		doneBody: `${value} can no longer accept.`,
	})

const acceptAdminCopy = (refuser: TimelockRefuser) => (): AdminCopy => ({
	refuser,
	reasons: {
		WindDownActive:
			"The vault is winding down, so the admin role can no longer change hands.",
	},
	verb: "accept the admin role",
	signing: `Signing makes this wallet the ${refuser} admin.`,
	done: "Admin accepted",
	doneBody: `This wallet is now the ${refuser} admin.`,
})

const proposalCopy =
	(refuser: TimelockRefuser) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "propose an upgrade",
		signing: `Signing queues ${value}.`,
		done: "Upgrade proposed",
		doneBody: `${value} can apply once ${WAITS[refuser]} passes.`,
	})

const VAULT_APPLY_REASONS: Reasons = {
	EnforcedPause: "The vault is paused; unpause it first.",
	WindDownActive: "The vault is winding down, so no change can apply.",
}

const applyChangeCopy =
	(refuser: TimelockRefuser) =>
	(value: string): AdminCopy => ({
		refuser,
		...(refuser === "vault" ? { reasons: VAULT_APPLY_REASONS } : {}),
		verb: "apply the change",
		signing: `Signing applies ${value}.`,
		done: "Change applied",
		doneBody: `Applied ${value}.`,
	})

const cancelChangeCopy =
	(refuser: TimelockRefuser) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: "cancel the change",
		signing: `Signing withdraws ${value}.`,
		done: "Change cancelled",
		doneBody: `Withdrew ${value}.`,
	})

const proposeWindDownCopy = (value: string): AdminCopy => ({
	refuser: "vault",
	verb: "propose a wind-down",
	signing: "Signing starts the wind-down countdown.",
	done: "Wind-down proposed",
	doneBody: value,
})

const cancelWindDownCopy = (): AdminCopy => ({
	refuser: "vault",
	verb: "cancel the wind-down",
	signing: "Signing withdraws the wind-down.",
	done: "Wind-down cancelled",
	doneBody: "The vault stays open.",
})

const GOVERNANCE_COPY: Record<
	GovernanceModalAction,
	(value: string) => AdminCopy
> = {
	"grant-vault-role": grantCopy("vault"),
	"revoke-vault-role": revokeCopy("vault"),
	"grant-oracle-role": grantCopy("oracle"),
	"revoke-oracle-role": revokeCopy("oracle"),
	"grant-token-role": grantCopy("share token"),
	"revoke-token-role": revokeCopy("share token"),
	"hand-over-vault-admin": handOverCopy("vault"),
	"cancel-vault-handover": cancelHandoverCopy("vault"),
	"accept-vault-admin": acceptAdminCopy("vault"),
	"hand-over-oracle-admin": handOverCopy("oracle"),
	"cancel-oracle-handover": cancelHandoverCopy("oracle"),
	"accept-oracle-admin": acceptAdminCopy("oracle"),
	"hand-over-token-admin": handOverCopy("share token"),
	"cancel-token-handover": cancelHandoverCopy("share token"),
	"accept-token-admin": acceptAdminCopy("share token"),
	"propose-grant-role": proposeCopy(
		"vault",
		"propose a role grant",
		"the grant of",
	),
	"propose-revoke-role": proposeCopy(
		"vault",
		"propose a role revoke",
		"the revoke of",
	),
	"propose-admin": proposeCopy(
		"vault",
		"propose the hand-over",
		"the hand-over to",
	),
	"propose-token-grant-role": proposeCopy(
		"share token",
		"propose a role grant",
		"the grant of",
	),
	"propose-token-revoke-role": proposeCopy(
		"share token",
		"propose a role revoke",
		"the revoke of",
	),
	"propose-token-admin": proposeCopy(
		"share token",
		"propose the hand-over",
		"the hand-over to",
	),
	"propose-oracle-grant-role": proposeCopy(
		"oracle",
		"propose a role grant",
		"the grant of",
	),
	"propose-oracle-revoke-role": proposeCopy(
		"oracle",
		"propose a role revoke",
		"the revoke of",
	),
	"propose-oracle-admin": proposeCopy(
		"oracle",
		"propose the hand-over",
		"the hand-over to",
	),
	"propose-code-upgrade": proposalCopy("vault"),
	"propose-upgrade-delay": proposalCopy("vault"),
	"propose-oracle-upgrade": proposalCopy("oracle"),
	"apply-change": applyChangeCopy("vault"),
	"cancel-change": cancelChangeCopy("vault"),
	"apply-token-change": applyChangeCopy("share token"),
	"cancel-token-change": cancelChangeCopy("share token"),
	"apply-oracle-change": applyChangeCopy("oracle"),
	"cancel-oracle-change": cancelChangeCopy("oracle"),
	"propose-wind-down": proposeWindDownCopy,
	"cancel-wind-down": cancelWindDownCopy,
}

const LEGAL_TRANSFER_REASONS: Reasons = {
	VaultAddress:
		"A legal transfer never moves shares into or out of the vault: they are other investors' escrow.",
	CoSignRequired:
		"The compliance account and the token admin must be two different accounts.",
	InvalidReference: "Enter a reference of 1 to 128 bytes.",
	IdentityVerificationFailed:
		"The destination is not allowlisted, so it cannot receive shares.",
}

const COMPLIANCE_COPY: Record<
	ComplianceModalAction,
	(value: string) => AdminCopy
> = {
	"allow-address": (value) => ({
		refuser: "identity verifier",
		verb: "allow the address",
		signing: `Signing adds ${value} to the allowlist.`,
		done: "Address allowed",
		doneBody: `${value} is on the allowlist.`,
	}),
	"disallow-address": (value) => ({
		refuser: "identity verifier",
		verb: "remove the address from the allowlist",
		signing: `Signing removes ${value} from the allowlist.`,
		done: "Removed from the allowlist",
		doneBody: `${value} is off the allowlist.`,
	}),
	"freeze-address": (value) => ({
		refuser: "share token",
		verb: "freeze the address",
		signing: `Signing freezes ${value}.`,
		done: "Address frozen",
		doneBody: `${value} is frozen.`,
	}),
	"unfreeze-address": (value) => ({
		refuser: "share token",
		verb: "unfreeze the address",
		signing: `Signing unfreezes ${value}.`,
		done: "Address unfrozen",
		doneBody: `${value} is no longer frozen.`,
	}),
	"freeze-shares": (value) => ({
		refuser: "share token",
		verb: "freeze shares",
		signing: `Signing freezes ${value}.`,
		done: "Shares frozen",
		doneBody: `Froze ${value}.`,
	}),
	"unfreeze-shares": (value) => ({
		refuser: "share token",
		verb: "unfreeze shares",
		signing: `Signing unfreezes ${value}.`,
		done: "Shares unfrozen",
		doneBody: `Unfroze ${value}.`,
	}),
	"legal-transfer": (value) => ({
		refuser: "share token",
		reasons: LEGAL_TRANSFER_REASONS,
		verb: "make a legal transfer",
		signing: `Signing approves moving ${value}.`,
		done: "Legal transfer made",
		doneBody: `Moved ${value}.`,
	}),
}

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

const WINDING_DOWN_NO_CHANGE =
	"The vault is winding down, so no change can be proposed or applied."

const CONTRACT_REASONS: Record<Refuser, Reasons> = {
	vault: { WindDownActive: "The wind-down is already active." },
	oracle: {
		SetupClosed: "The oracle's setup has already finished.",
		VaultNotBound: "The oracle is not bound to a vault yet.",
		WindDownActive: WINDING_DOWN_NO_CHANGE,
		VaultPaused:
			"The vault is paused, which holds every oracle change; unpause it first.",
		DelayBelowNotice:
			"The change's delay is shorter than the vault's notice now, so it cannot apply.",
	},
	"share token": {
		WindDownActive: WINDING_DOWN_NO_CHANGE,
		VaultPaused:
			"The vault is paused, which holds every share-token change; unpause it first.",
	},
	"identity verifier": {},
}

const adminReasons = (refuser: Refuser): Reasons => ({
	// the oracle pauses through NavPaused/NavNotPaused, so OZ pause errors there are the vault's
	...(refuser === "oracle"
		? {}
		: {
				EnforcedPause: `The ${refuser} is already paused.`,
				ExpectedPause: `The ${refuser} is not paused, so there is nothing to unpause.`,
			}),
	InsufficientBalance: "The address does not hold enough shares.",
	LessThanZero: "The amount cannot be negative.",
	InsufficientFreeTokens: "The address does not have that many frozen shares.",
	Unauthorized: "This wallet does not hold the role this action needs.",
	AdminNotSet: `The ${refuser} has no admin.`,
	IndexOutOfBounds: "The role's holders changed before this was recorded.",
	RoleNotHeld: "The account does not hold this role.",
	MaxRolesExceeded: `The ${refuser} already has the maximum number of roles.`,
	NoPendingTransfer: "There is no pending handover.",
	InvalidLiveUntilLedger: "The expiry is outside what the network allows.",
	InvalidPendingAccount: "The pending handover is to a different address.",
	TransferExpired: "The handover expired before it was accepted.",
	ChangeNotFound: "There is no pending change with that id.",
	ChangeNotReady: "The change's delay has not passed yet.",
	TooManyPendingChanges:
		"There are already 16 pending changes; apply or cancel one first.",
	SetupOpen: "Setup is still open, so no change can be proposed yet.",
	UseTimelock: "After setup this change goes through the timelock.",
	AdminTransferPending: "An admin hand-over is still pending; cancel it first.",
	WindDownNotProposed: "No wind-down is proposed.",
	WindDownAlreadyProposed: "A wind-down is already proposed.",
	UpgradeProposalExists: "A code change is already pending; one at a time.",
	UpgradeDelayTooShort: "The upgrade delay cannot be under 7 days.",
	UpgradeDelayBelowNotice: "The upgrade delay cannot be under the notice.",
	UpgradeDelayTooLong: "The upgrade delay cannot exceed 90 days.",
	WindDownDelayTooShort: "The wind-down delay cannot be under 7 days.",
	InvalidCustodian: "The custodian cannot be the vault itself.",
	InvalidAmount: "The deposit cap cannot be negative.",
	NoticeTooLong: "The notice cannot exceed 30 days.",
	WindDownDelayTooLong: "The wind-down delay cannot exceed 90 days.",
	NoticeAboveUpgradeDelay: "The notice cannot exceed the upgrade delay.",
	InvalidConfig: "One of the oracle limits is out of range.",
	NavNotPaused: "The NAV is not paused, so the latest price cannot be cleared.",
	UpgradeAlreadyPending: "A code upgrade is already pending; cancel it first.",
	...CONTRACT_REASONS[refuser],
})

const describeShared = (expiresAt: Date | null) => {
	const invitation = "Share the link with the next signer."
	if (expiresAt === null) return invitation
	const seconds = BigInt(Math.floor(expiresAt.getTime() / 1000))
	return `${invitation} Valid until ${formatDate(seconds)}.`
}

const describeSharedStanding = (status: SharedTransaction): Copy =>
	status.standing === "admin-authorization"
		? {
				heading: "Needs the token admin's authorization",
				body: "Share the link with the token admin. Once they authorize it, compliance's signers sign it.",
			}
		: {
				heading: describeStanding(status.standing),
				body: describeShared(status.expiresAt),
			}

const adminStatusCopy = (copy: AdminCopy, followUp: string): StatusCopy => ({
	followUp,
	refuser: copy.refuser,
	reasons: { ...adminReasons(copy.refuser), ...copy.reasons },
	fallback: `The ${copy.refuser} refused this request. Try again, and contact support if it keeps happening.`,
	preparing: {
		heading: `Preparing to ${copy.verb}`,
		body: "We are getting it ready. Your wallet will ask you to approve it next.",
	},
	awaitingSignature: { heading: "Confirm in your wallet", body: copy.signing },
	submitted: {
		heading: "Sending",
		body: "It is on its way to the network. This should only take a moment. Closing this window will not stop it.",
	},
	shared: describeSharedStanding,
	confirmed: () => ({ heading: copy.done, body: copy.doneBody }),
})

const inTab = <Id extends string>(
	table: Record<Id, AdminCopy | ((value: string) => AdminCopy)>,
	followUp: string,
): Record<Id, (value: string) => StatusCopy> =>
	Object.fromEntries(
		Object.entries<AdminCopy | ((value: string) => AdminCopy)>(table).map(
			([id, copy]) => [
				id,
				(value: string) =>
					adminStatusCopy(
						typeof copy === "function" ? copy(value) : copy,
						followUp,
					),
			],
		),
	) as Record<Id, (value: string) => StatusCopy>

export const ADMIN_COPY: Record<
	AdminModalAction,
	(value: string) => StatusCopy
> = {
	...inTab(EMERGENCY_COPY, EMERGENCY_FOLLOW_UP),
	...inTab(CONFIGURATION_COPY, CONFIGURATION_FOLLOW_UP),
	...inTab(GOVERNANCE_COPY, GOVERNANCE_FOLLOW_UP),
	...inTab(COMPLIANCE_COPY, COMPLIANCE_FOLLOW_UP),
}

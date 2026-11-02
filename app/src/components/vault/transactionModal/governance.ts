import {
	type AdminCopy,
	type TimelockRefuser,
	WAITS,
	proposeCopy,
} from "./adminCopy"
import { type GovernanceModalAction } from "./types"

export const GOVERNANCE_FOLLOW_UP =
	"check the Governance tab before trying again"
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

const ACCEPT_WIND_DOWN_CODES: Record<TimelockRefuser, number> = {
	vault: 6046,
	oracle: 3018,
	"share token": 7008,
}

const acceptAdminCopy = (refuser: TimelockRefuser) => (): AdminCopy => ({
	refuser,
	reasons: {
		[ACCEPT_WIND_DOWN_CODES[refuser]]:
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

const VAULT_APPLY_REASONS = {
	1000: "The vault is paused; unpause it first.",
	6046: "The vault is winding down, so no change can apply.",
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

export const GOVERNANCE_COPY: Record<
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

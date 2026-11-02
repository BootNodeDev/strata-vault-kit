import { type TransactionStatus } from "../../../hooks/useContractTransaction"
import { describeStanding } from "../../../pages/actions"
import { describeFailure, describeShared } from "./outcome"

export type AdminCopy = {
	refuser: "vault" | "share token" | "oracle" | "identity verifier"
	reasons?: Partial<Record<number, string>>
	verb: string
	signing: string
	done: string
	doneBody: string
}

const capitalize = (text: string): string =>
	`${text.charAt(0).toUpperCase()}${text.slice(1)}`

export type TimelockRefuser = Extract<
	AdminCopy["refuser"],
	"vault" | "share token" | "oracle"
>

export const WAITS: Record<TimelockRefuser, string> = {
	vault: "the upgrade delay",
	"share token": "the vault's upgrade delay",
	oracle: "the vault's upgrade delay",
}

export const proposeCopy =
	(refuser: TimelockRefuser, verb: string, subject: string) =>
	(value: string): AdminCopy => ({
		refuser,
		verb,
		signing: `Signing queues ${subject} ${value}.`,
		done: "Change proposed",
		doneBody: `${capitalize(subject)} ${value} applies once ${WAITS[refuser]} passes.`,
	})

const adminContractErrorReason =
	(refuser: AdminCopy["refuser"]) =>
	(code: number): string => {
		switch (code) {
			case 1000:
				return `The ${refuser} is already paused.`
			case 1001:
				return `The ${refuser} is not paused, so there is nothing to unpause.`
			case 300:
				return "The address does not hold enough shares."
			case 301:
				return "The amount cannot be negative."
			case 303:
				return "The address does not have that many frozen shares."
			case 2000:
				return "This wallet does not hold the role this action needs."
			case 2001:
				return `The ${refuser} has no admin.`
			case 2002:
				return "The role's holders changed before this was recorded."
			case 2007:
				return "The account does not hold this role."
			case 2010:
				return `The ${refuser} already has the maximum number of roles.`
			case 2200:
				return "There is no pending handover."
			case 2201:
				return "The expiry is outside what the network allows."
			case 2202:
				return "The pending handover is to a different address."
			case 2203:
				return "The handover expired before it was accepted."
			case 6046:
				return "The wind-down is already active."
			case 6047:
				return "No wind-down is proposed."
			case 6048:
				return "A wind-down is already proposed."
			case 6055:
				return "A code change is already pending; one at a time."
			case 6056:
				return "There is no pending change with that id."
			case 6057:
				return "The change's delay has not passed yet."
			case 6058:
				return "The upgrade delay cannot be under 7 days."
			case 6059:
				return "The upgrade delay cannot be under the notice."
			case 6060:
				return "The upgrade delay cannot exceed 90 days."
			case 6063:
				return "There are already 16 pending changes; apply or cancel one first."
			case 6064:
				return "Setup is still open, so no change can be proposed yet."
			case 6065:
				return "After setup this change goes through the timelock."
			case 6069:
				return "The wind-down delay cannot be under 7 days."
			case 6075:
				return "The custodian cannot be the vault itself."
			case 3001:
				return "One of the oracle limits is out of range."
			case 3008:
				return "The NAV is not paused, so the latest price cannot be cleared."
			case 3011:
				return "There is no pending change with that id."
			case 3012:
				return "The change's delay has not passed yet."
			case 3013:
				return "There are already 16 pending changes; apply or cancel one first."
			case 3014:
				return "Setup is still open, so no change can be proposed yet."
			case 3015:
				return "After setup this change goes through the timelock."
			case 3016:
				return "The oracle's setup has already finished."
			case 3017:
				return "The oracle is not bound to a vault yet."
			case 3018:
				return "The vault is winding down, so no change can be proposed or applied."
			case 3019:
				return "The vault is paused, which holds every oracle change; unpause it first."
			case 3020:
				return "The change's delay is shorter than the vault's notice now, so it cannot apply."
			case 3021:
				return "A code upgrade is already pending; cancel it first."
			case 6007:
				return "The deposit cap cannot be negative."
			case 6045:
				return "The notice cannot exceed 30 days."
			case 6053:
				return "The wind-down delay cannot exceed 90 days."
			case 6061:
				return "The notice cannot exceed the upgrade delay."
			case 7001:
				return "There is no pending change with that id."
			case 7002:
				return "The change's delay has not passed yet."
			case 7003:
				return "There are already 16 pending changes; apply or cancel one first."
			case 7004:
				return "Setup is still open, so no change can be proposed yet."
			case 7005:
				return "After setup this change goes through the timelock."
			case 7008:
				return "The vault is winding down, so no change can be proposed or applied."
			case 7009:
				return "The vault is paused, which holds every share-token change; unpause it first."
			case 7011:
				return "A code upgrade is already pending; cancel it first."
			case 7016:
				return "An admin hand-over is still pending; cancel it first."
			default:
				return `The ${refuser} refused this request. Try again, and contact support if it keeps happening.`
		}
	}

export const describeAdminStatus = (
	copy: AdminCopy,
	status: TransactionStatus,
	followUp: string,
): { heading: string; body: string; hash?: string } | undefined => {
	switch (status.status) {
		case "idle":
			return undefined
		case "preparing":
			return {
				heading: `Preparing to ${copy.verb}`,
				body: "We are getting it ready. Your wallet will ask you to approve it next.",
			}
		case "awaiting-signature":
			return { heading: "Confirm in your wallet", body: copy.signing }
		case "submitted":
			return {
				heading: "Sending",
				body: "It is on its way to the network. This should only take a moment. Closing this window will not stop it.",
				hash: status.hash,
			}
		case "shared":
			if (status.standing === "admin-authorization")
				return {
					heading: "Needs the token admin's authorization",
					body: "Share the link with the token admin. Once they authorize it, compliance's signers sign it.",
				}
			return {
				heading: describeStanding(status.standing),
				body: describeShared(status.expiresAt),
			}
		case "confirmed":
			return { heading: copy.done, body: copy.doneBody, hash: status.hash }
		case "failed":
			return {
				...describeFailure(
					status.failure,
					(code) =>
						copy.reasons?.[code] ??
						adminContractErrorReason(copy.refuser)(code),
					followUp,
					copy.refuser,
				),
				hash: status.hash,
			}
	}
}

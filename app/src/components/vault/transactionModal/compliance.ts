import { type AdminCopy } from "./adminCopy"
import { type ComplianceModalAction } from "./types"

export const COMPLIANCE_FOLLOW_UP =
	"check the Compliance tab before trying again"

const LEGAL_TRANSFER_REASONS: Partial<Record<number, string>> = {
	7012: "A legal transfer never moves shares into or out of the vault: they are other investors' escrow.",
	7013: "The compliance account and the token admin must be two different accounts.",
	7015: "Enter a reference of 1 to 128 bytes.",
	304: "The destination is not allowlisted, so it cannot receive shares.",
}

export const COMPLIANCE_COPY: Record<
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

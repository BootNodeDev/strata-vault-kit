import { type AdminCopy } from "./adminCopy"
import { type EmergencyModalAction } from "./types"

export const EMERGENCY_FOLLOW_UP = "check the Emergency tab before trying again"
export const EMERGENCY_COPY: Record<EmergencyModalAction, AdminCopy> = {
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

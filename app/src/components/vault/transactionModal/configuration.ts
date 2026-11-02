import { EFFECTS } from "../../../pages/configuration"
import { type AdminCopy, WAITS, proposeCopy } from "./adminCopy"
import { type ConfigurationModalAction } from "./types"

export const CONFIGURATION_FOLLOW_UP =
	"check the Configuration tab before trying again"
const setterCopy =
	(refuser: AdminCopy["refuser"], subject: string, effect?: string) =>
	(value: string): AdminCopy => ({
		refuser,
		verb: `set the ${subject.toLowerCase()}`,
		signing: `New ${subject.toLowerCase()}: ${value}.`,
		done: `${subject} updated`,
		doneBody: effect ?? `${subject}: ${value}.`,
	})

const MIN_EPOCH_DURATION_REASONS = {
	6007: "The minimum epoch duration must be 1 to 30 days.",
}

export const CONFIGURATION_COPY: Record<
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

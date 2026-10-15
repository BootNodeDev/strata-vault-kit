import { Buffer } from "buffer"
import {
	type AccountSigners,
	type Amount,
	formatDate,
	formatExact,
	InvalidPendingTransaction,
	type PendingTransaction,
	PRICE_DECIMALS,
	type Price,
	shortAddress,
} from "@stellar-scaffold/app-lib"
import {
	ADMIN_VERBS,
	type AdminModalAction,
	type EmergencyModalAction,
	type TransactionModalProps,
} from "../components/vault/TransactionModal"
import { type TransactionStatus } from "../hooks/useContractTransaction"
import {
	exactAmount,
	formatDuration,
	formatPercent,
	formatSignedPrice,
} from "./cycle"

export type SignContract =
	"Vault" | "Oracle" | "Share token" | "Identity verifier"

export type SignAction = AdminModalAction | "close-epoch" | "attest" | "deploy"

export type SignArg = { label: string; value: string }

export type SignDescription = {
	contract: SignContract
	action: SignAction
	label: string
	args: SignArg[]
}

export type SignAddresses = {
	vault: string
	oracle: string
	shareToken: string
}

export type SignStatus = TransactionStatus<{ result: unknown }>

type Decoded = { action: SignAction; args: SignArg[] }
type Decoder = (args: unknown[]) => Decoded

const malformed = () => new InvalidPendingTransaction("malformed arguments")

const address = (value: unknown): string => {
	if (typeof value !== "string") throw malformed()
	return value
}

const integer = (value: unknown): bigint => {
	if (typeof value !== "bigint") throw malformed()
	return value
}

const count = (value: unknown): number => {
	if (typeof value !== "number") throw malformed()
	return value
}

const flag = (value: unknown): boolean => {
	if (typeof value !== "boolean") throw malformed()
	return value
}

const hex = (value: unknown): string => {
	if (!(value instanceof Uint8Array)) throw malformed()
	return Buffer.from(value).toString("hex")
}

const record = (value: unknown): Record<string, unknown> => {
	if (typeof value !== "object" || value === null) throw malformed()
	return value as Record<string, unknown>
}

const addr = (label: string, value: unknown): SignArg => ({
	label,
	value: shortAddress(address(value)),
})

const amount = (label: string, value: unknown): SignArg => ({
	label,
	value: exactAmount(integer(value) as Amount),
})

const duration = (label: string, value: unknown): SignArg => ({
	label,
	value: formatDuration(integer(value)),
})

const price = (label: string, value: unknown): SignArg => ({
	label,
	value: formatExact(integer(value) as Price, PRICE_DECIMALS),
})

const only =
	(action: SignAction): Decoder =>
	() => ({ action, args: [] })

const governed = (
	contract: "vault" | "oracle" | "token",
): Record<string, Decoder> => ({
	grant_role: ([account, role]) => ({
		action: `grant-${contract}-role`,
		args: [{ label: "Role", value: address(role) }, addr("Account", account)],
	}),
	revoke_role: ([account, role]) => ({
		action: `revoke-${contract}-role`,
		args: [{ label: "Role", value: address(role) }, addr("Account", account)],
	}),
	transfer_admin_role: ([newAdmin, liveUntil]) =>
		count(liveUntil) === 0
			? {
					action: `cancel-${contract}-handover`,
					args: [addr("New admin", newAdmin)],
				}
			: {
					action: `hand-over-${contract}-admin`,
					args: [
						addr("New admin", newAdmin),
						{ label: "Open until ledger", value: String(count(liveUntil)) },
					],
				},
	accept_admin_transfer: only(`accept-${contract}-admin`),
})

const VAULT: Record<string, Decoder> = {
	...governed("vault"),
	pause: only("pause-vault"),
	unpause: only("unpause-vault"),
	set_deposit_cap: ([cap]) => ({
		action: "set-deposit-cap",
		args: [
			{
				label: "Deposit cap",
				value: cap === null ? "No cap" : exactAmount(integer(cap) as Amount),
			},
		],
	}),
	set_custodian: ([custodian]) => ({
		action: "set-custodian",
		args: [addr("Custodian", custodian)],
	}),
	set_notice: ([secs]) => ({
		action: "set-notice",
		args: [duration("Notice", secs)],
	}),
	set_wind_down_delay: ([secs]) => ({
		action: "set-wind-down-delay",
		args: [duration("Wind-down delay", secs)],
	}),
	propose_upgrade: ([hash]) => ({
		action: "propose-code-upgrade",
		args: [{ label: "Wasm hash", value: hex(hash) }],
	}),
	propose_upgrade_delay: ([secs]) => ({
		action: "propose-upgrade-delay",
		args: [duration("Upgrade delay", secs)],
	}),
	apply_upgrade: only("apply-upgrade"),
	cancel_upgrade: only("cancel-upgrade"),
	propose_wind_down: only("propose-wind-down"),
	cancel_wind_down_proposal: only("cancel-wind-down"),
	close_epoch: only("close-epoch"),
	deploy_to_custodian: ([, assets]) => ({
		action: "deploy",
		args: [amount("Amount", assets)],
	}),
}

const oracleLimits = (config: Record<string, unknown>): SignArg[] => [
	duration("Freshness window", config.freshness_duration),
	duration("Cooldown", config.cooldown_secs),
	{ label: "Largest rise", value: formatPercent(count(config.max_up_bps)) },
	{
		label: "Largest fall",
		value:
			config.max_down_bps === null
				? "No limit"
				: formatPercent(count(config.max_down_bps)),
	},
	price("Price floor", config.min_answer),
	price("Price ceiling", config.max_answer),
]

const ORACLE: Record<string, Decoder> = {
	...governed("oracle"),
	raise_ripcord: only("raise-ripcord"),
	set_ripcord: ([paused]) => ({
		action: flag(paused) ? "raise-ripcord" : "lower-ripcord",
		args: [],
	}),
	clear_latest: only("clear-latest"),
	set_config: ([config]) => ({
		action: "set-oracle-config",
		args: oracleLimits(record(config)),
	}),
	attest: ([report]) => {
		const { nav_per_share, expires_at } = record(report)
		return {
			action: "attest",
			args: [
				{
					label: "Price",
					value: formatSignedPrice(integer(nav_per_share) as Price),
				},
				{ label: "Expires", value: formatDate(integer(expires_at)) },
			],
		}
	},
}

const TOKEN: Record<string, Decoder> = {
	...governed("token"),
	pause: only("pause-token"),
	unpause: only("unpause-token"),
	set_compliance: ([compliance]) => ({
		action: "set-compliance",
		args: [addr("Compliance contract", compliance)],
	}),
	set_identity_verifier: ([verifier]) => ({
		action: "set-identity-verifier",
		args: [addr("Identity verifier", verifier)],
	}),
	set_address_frozen: ([account, freeze]) => ({
		action: flag(freeze) ? "freeze-address" : "unfreeze-address",
		args: [addr("Address", account)],
	}),
	freeze_partial_tokens: ([account, shares]) => ({
		action: "freeze-shares",
		args: [addr("Address", account), amount("Amount", shares)],
	}),
	unfreeze_partial_tokens: ([account, shares]) => ({
		action: "unfreeze-shares",
		args: [addr("Address", account), amount("Amount", shares)],
	}),
	forced_transfer: ([from, to, shares]) => ({
		action: "force-transfer",
		args: [addr("From", from), addr("To", to), amount("Amount", shares)],
	}),
}

const VERIFIER: Record<string, Decoder> = {
	allow: ([account, allowed]) => ({
		action: flag(allowed) ? "allow-address" : "disallow-address",
		args: [addr("Address", account)],
	}),
}

const CYCLE_VERBS: Record<Exclude<SignAction, AdminModalAction>, string> = {
	"close-epoch": "close the epoch",
	attest: "attest the price",
	deploy: "deploy to the custodian",
}

const VERBS: Record<SignAction, string> = { ...ADMIN_VERBS, ...CYCLE_VERBS }

const contractOf = (
	contractId: string,
	addresses: SignAddresses,
): { contract: SignContract; table: Record<string, Decoder> } => {
	if (contractId === addresses.vault) return { contract: "Vault", table: VAULT }
	if (contractId === addresses.oracle)
		return { contract: "Oracle", table: ORACLE }
	if (contractId === addresses.shareToken)
		return { contract: "Share token", table: TOKEN }
	return { contract: "Identity verifier", table: VERIFIER }
}

export function describePending(
	pending: PendingTransaction,
	addresses: SignAddresses,
): SignDescription {
	const { contract, table } = contractOf(pending.contractId, addresses)
	const decode = table[pending.fn]
	if (decode === undefined) {
		throw new InvalidPendingTransaction("unknown operation")
	}
	const { action, args } = decode(pending.args)
	const verb = VERBS[action]
	return {
		contract,
		action,
		label: verb.charAt(0).toUpperCase() + verb.slice(1),
		args,
	}
}

export type PendingState =
	"valid" | "expired" | "consumed" | "not-signer" | "already-signed" | "ready"

export type PendingStateInput = {
	now: Date
	expiresAt: Date | null
	sequence: string
	accountSequence: string | null
	weight: number
	threshold: number
	walletIsSigner: boolean | null
	walletHasSigned: boolean
}

export function pendingState(input: PendingStateInput): PendingState {
	if (input.expiresAt !== null && input.expiresAt <= input.now) return "expired"
	if (
		input.accountSequence !== null &&
		BigInt(input.sequence) !== BigInt(input.accountSequence) + 1n
	) {
		return "consumed"
	}
	if (input.weight >= input.threshold) return "ready"
	if (input.walletHasSigned) return "already-signed"
	if (input.walletIsSigner === false) return "not-signer"
	return "valid"
}

export const STATE_COPY: Record<PendingState, string> = {
	valid: "Waiting for signatures.",
	expired: "This transaction expired.",
	consumed: "The account moved on; this transaction is no longer valid.",
	"not-signer": "Your wallet does not sign for this account.",
	"already-signed": "You already signed. Share the link with the next signer.",
	ready: "Signatures complete. Anyone can submit.",
}

export const describeCollected = (
	weight: number,
	signers: AccountSigners,
): string => {
	const threshold = signers.thresholds.med
	const everySignerWeighsOne = signers.signers.every(
		({ weight: other }) => other <= 1,
	)
	return everySignerWeighsOne
		? `${weight} of ${threshold} signatures`
		: `weight ${weight} of threshold ${threshold}`
}

type ModalHandlers = { onClose: () => void; onRetry: () => void }

const EMERGENCY_ACTIONS: ReadonlySet<string> = new Set<EmergencyModalAction>([
	"pause-vault",
	"unpause-vault",
	"raise-ripcord",
	"lower-ripcord",
	"clear-latest",
	"pause-token",
	"unpause-token",
])

const isEmergency = (action: SignAction): action is EmergencyModalAction =>
	EMERGENCY_ACTIONS.has(action)

const sealedEpochOf = (
	status: SignStatus,
): TransactionStatus<{ sealedEpoch: bigint }> =>
	status.status === "confirmed"
		? { ...status, sealedEpoch: integer(status.result) }
		: status

export function toModalProps(
	description: SignDescription,
	status: SignStatus,
	handlers: ModalHandlers,
): TransactionModalProps {
	const { action, args } = description
	switch (action) {
		case "close-epoch":
			return { action, status: sealedEpochOf(status), epoch: "", ...handlers }
		case "attest":
			return {
				action,
				status,
				price: args[0]?.value ?? "",
				validFor: null,
				...handlers,
			}
		case "deploy":
			return { action, status, amount: args[0]?.value ?? "", ...handlers }
		default:
			if (isEmergency(action)) return { action, status, ...handlers }
			return {
				action,
				status,
				value: args.map(({ value }) => value).join(", "),
				...handlers,
			}
	}
}

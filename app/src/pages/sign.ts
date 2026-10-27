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
	uniformWeights,
} from "@stellar-scaffold/app-lib"
import {
	ADMIN_VERBS,
	type AdminModalAction,
	type EmergencyModalAction,
	type TransactionModalProps,
} from "../components/vault/TransactionModal"
import { type TransactionStatus } from "../hooks/useContractTransaction"
import { type TimelockedContract } from "../hooks/useSetupOpen"
import {
	exactAmount,
	formatDuration,
	formatPercent,
	formatSignedPrice,
} from "./cycle"
import { changeName, type PendingChange, QUEUES } from "./pendingChanges"

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
	identityVerifier: string
}

export type SignStatus = TransactionStatus<{ result: unknown }>

type Decoded = { action: SignAction; args: SignArg[] }
type Decoder = (args: unknown[]) => Decoded

const malformed = () => new InvalidPendingTransaction("malformed arguments")

const text = (value: unknown): string => {
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
	value: shortAddress(text(value)),
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
		args: [{ label: "Role", value: text(role) }, addr("Account", account)],
	}),
	revoke_role: ([account, role]) => ({
		action: `revoke-${contract}-role`,
		args: [{ label: "Role", value: text(role) }, addr("Account", account)],
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

const roleArgs = (role: unknown, account: unknown): SignArg[] => [
	{ label: "Role", value: text(role) },
	addr("Account", account),
]

const roleProposals = (
	grant: SignAction,
	revoke: SignAction,
	admin: SignAction,
): Record<string, Decoder> => ({
	GrantRole: ([role, account]) => ({
		action: grant,
		args: roleArgs(role, account),
	}),
	RevokeRole: ([role, account]) => ({
		action: revoke,
		args: roleArgs(role, account),
	}),
	Admin: ([account]) => ({
		action: admin,
		args: [addr("New admin", account)],
	}),
})

const VAULT_PROPOSALS: Record<string, Decoder> = {
	Custodian: ([custodian]) => ({
		action: "propose-custodian",
		args: [addr("Custodian", custodian)],
	}),
	Notice: ([secs]) => ({
		action: "propose-notice",
		args: [duration("Notice", secs)],
	}),
	WindDownDelay: ([secs]) => ({
		action: "propose-wind-down-delay",
		args: [duration("Wind-down delay", secs)],
	}),
	Upgrade: ([hash]) => ({
		action: "propose-code-upgrade",
		args: [{ label: "Wasm hash", value: hex(hash) }],
	}),
	UpgradeDelay: ([secs]) => ({
		action: "propose-upgrade-delay",
		args: [duration("Upgrade delay", secs)],
	}),
	...roleProposals(
		"propose-grant-role",
		"propose-revoke-role",
		"propose-admin",
	),
}

const TOKEN_PROPOSALS: Record<string, Decoder> = {
	Compliance: ([compliance]) => ({
		action: "propose-compliance",
		args: [addr("Compliance contract", compliance)],
	}),
	IdentityVerifier: ([verifier]) => ({
		action: "propose-identity-verifier",
		args: [addr("Identity verifier", verifier)],
	}),
	...roleProposals(
		"propose-token-grant-role",
		"propose-token-revoke-role",
		"propose-token-admin",
	),
}

const decoderOf = (table: Record<string, Decoder>, name: unknown): Decoder => {
	if (typeof name !== "string" || !Object.hasOwn(table, name))
		throw new InvalidPendingTransaction("unknown operation")
	return table[name] as Decoder
}

const proposal =
	(table: Record<string, Decoder>): Decoder =>
	([change]) => {
		if (!Array.isArray(change)) throw malformed()
		const [tag, ...values] = change as unknown[]
		return decoderOf(table, tag)(values)
	}

export type SignChanges = Partial<Record<TimelockedContract, PendingChange[]>>

const byId =
	(
		action: SignAction,
		contract: TimelockedContract,
		changes: SignChanges,
	): Decoder =>
	([id]) => {
		const { name } = QUEUES[contract]
		const known = changes[contract]?.find((change) => change.id === count(id))
		return {
			action,
			args: [
				{
					label: "Change",
					value:
						known === undefined
							? `${name} change #${count(id)}`
							: changeName(name, known),
				},
			],
		}
	}

const timelockDecoders = (
	contract: TimelockedContract,
	proposals: Record<string, Decoder>,
	changes: SignChanges,
): Record<string, Decoder> => ({
	propose_change: proposal(proposals),
	apply_change: byId(QUEUES[contract].apply, contract, changes),
	cancel_change: byId(QUEUES[contract].cancel, contract, changes),
})

const vaultDecoders = (changes: SignChanges): Record<string, Decoder> => ({
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
	...timelockDecoders("vault", VAULT_PROPOSALS, changes),
	propose_wind_down: only("propose-wind-down"),
	cancel_wind_down_proposal: only("cancel-wind-down"),
	close_epoch: only("close-epoch"),
	deploy_to_custodian: ([, assets]) => ({
		action: "deploy",
		args: [amount("Amount", assets)],
	}),
})

const oracleLimits = (config: Record<string, unknown>): SignArg[] => [
	duration("Freshness window", config.freshness_duration),
	duration("Cooldown", config.cooldown_secs),
	{ label: "Largest rise", value: formatPercent(count(config.max_up_bps)) },
	{ label: "Largest fall", value: formatPercent(count(config.max_down_bps)) },
	price("Price floor", config.min_answer),
	price("Price ceiling", config.max_answer),
]

const ORACLE: Record<string, Decoder> = {
	...governed("oracle"),
	pause_nav: only("pause-nav"),
	set_nav_paused: ([paused]) => ({
		action: flag(paused) ? "pause-nav" : "unpause-nav",
		args: [],
	}),
	clear_latest: only("clear-latest"),
	set_config: ([config]) => ({
		action: "set-oracle-config",
		args: oracleLimits(record(config)),
	}),
	attest: ([input]) => {
		const { nav_per_share, expires_at, proof_hash, proof_uri } = record(input)
		const uri = text(proof_uri)
		return {
			action: "attest",
			args: [
				{
					label: "Price",
					value: formatSignedPrice(integer(nav_per_share) as Price),
				},
				{ label: "Expires", value: formatDate(integer(expires_at)) },
				{ label: "Proof hash", value: hex(proof_hash) },
				{ label: "Proof URI", value: uri === "" ? "None" : uri },
			],
		}
	},
}

const tokenDecoders = (changes: SignChanges): Record<string, Decoder> => ({
	...governed("token"),
	...timelockDecoders("token", TOKEN_PROPOSALS, changes),
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
})

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
	changes: SignChanges,
): { contract: SignContract; table: Record<string, Decoder> } => {
	if (contractId === addresses.vault)
		return { contract: "Vault", table: vaultDecoders(changes) }
	if (contractId === addresses.oracle)
		return { contract: "Oracle", table: ORACLE }
	if (contractId === addresses.shareToken)
		return { contract: "Share token", table: tokenDecoders(changes) }
	if (contractId === addresses.identityVerifier) {
		return { contract: "Identity verifier", table: VERIFIER }
	}
	throw new InvalidPendingTransaction("unknown contract")
}

export function describePending(
	pending: PendingTransaction,
	addresses: SignAddresses,
	changes: SignChanges = {},
): SignDescription {
	const { contract, table } = contractOf(pending.contractId, addresses, changes)
	const { action, args } = decoderOf(table, pending.fn)(pending.args)
	const verb = VERBS[action]
	return {
		contract,
		action,
		label: verb.charAt(0).toUpperCase() + verb.slice(1),
		args,
	}
}

export type PendingState =
	| "valid"
	| "expired"
	| "consumed"
	| "executed"
	| "not-signer"
	| "already-signed"
	| "ready"

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
	executed: "This transaction was already submitted.",
	"not-signer": "Your wallet does not sign for this account.",
	"already-signed": "You already signed. Share the link with the next signer.",
	ready: "Signatures complete. Anyone can submit.",
}

export type StateTone = "neutral" | "success" | "danger" | "muted"

export type StateView = {
	pill: string
	tone: StateTone
	nextStep: string | null
	shareable: boolean
}

const SHARE_NEXT = "Share the link with the next signer."
const NEW_LINK = "Ask the proposer for a new link."

export const STATE_VIEW: Record<PendingState, StateView> = {
	valid: {
		pill: "Waiting for signatures",
		tone: "neutral",
		nextStep: SHARE_NEXT,
		shareable: true,
	},
	ready: {
		pill: "Ready to submit",
		tone: "success",
		nextStep: "Anyone can submit this transaction.",
		shareable: true,
	},
	"already-signed": {
		pill: "You already signed",
		tone: "neutral",
		nextStep: SHARE_NEXT,
		shareable: true,
	},
	expired: {
		pill: "Expired",
		tone: "danger",
		nextStep: NEW_LINK,
		shareable: false,
	},
	consumed: {
		pill: "Account moved on",
		tone: "danger",
		nextStep: NEW_LINK,
		shareable: false,
	},
	executed: {
		pill: "Executed",
		tone: "success",
		nextStep: null,
		shareable: false,
	},
	"not-signer": {
		pill: "Not a signer",
		tone: "muted",
		nextStep: "Only a signer of this account can sign.",
		shareable: true,
	},
}

export type PrimaryAction = {
	label: "Sign" | "Submit" | "Connect a wallet to sign"
	enabled: boolean
}

export const primaryAction = (
	state: PendingState,
	hasWallet: boolean,
	canSign: boolean,
): PrimaryAction | null => {
	if (state === "ready") return { label: "Submit", enabled: true }
	if (state !== "valid") return null
	return hasWallet
		? { label: "Sign", enabled: canSign }
		: { label: "Connect a wallet to sign", enabled: false }
}

const clock = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
	timeZone: "UTC",
})

export const describeExpiry = (expiresAt: Date | null): string => {
	if (expiresAt === null) return "No expiry"
	const seconds = BigInt(Math.floor(expiresAt.getTime() / 1000))
	return `${formatDate(seconds)}, ${clock.format(expiresAt)} UTC`
}

export const describeCollected = (
	weight: number,
	signers: AccountSigners,
): string => {
	const threshold = signers.thresholds.med
	return uniformWeights(signers.signers)
		? `${weight} of ${threshold} signatures`
		: `weight ${weight} of threshold ${threshold}`
}

type ModalHandlers = { onClose: () => void; onRetry: () => void }

const EMERGENCY_ACTIONS: ReadonlySet<string> = new Set<EmergencyModalAction>([
	"pause-vault",
	"unpause-vault",
	"pause-nav",
	"unpause-nav",
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

import {
	AMOUNT_DECIMALS,
	type Amount,
	formatDayMonth,
	formatScaled,
	type Price,
} from "@stellar-scaffold/app-lib"
import {
	type RequestAction,
	type RequestEntry,
	type RequestStage,
	type RequestTone,
} from "../components/vault/RequestCard"
import {
	type ArchivedRequest,
	type InvestorRequest,
	type RequestSide,
	type UnreadableRequest,
} from "../hooks/useInvestorRequests"
import { type Allowance } from "../hooks/useIsAllowed"

export type RequestTokens = { token: string; shareToken: string }

export type ClaimRefusal = { reason: string }

export type LoadedRequests = {
	requests: InvestorRequest[]
	archived: ArchivedRequest[]
	unreadable: UnreadableRequest[]
}

export type EntriesByStage = Record<RequestStage, RequestEntry[]>

const WAD = 10n ** 18n

const stageTone: Record<RequestStage, RequestTone> = {
	waiting: "pending",
	ready: "claimable",
	blocked: "blocked",
}

const sideLabel: Record<RequestSide, string> = {
	deposit: "Subscription",
	redeem: "Redemption",
}

const inTicker = (side: RequestSide, tokens: RequestTokens): string =>
	side === "deposit" ? tokens.token : tokens.shareToken

const outTicker = (side: RequestSide, tokens: RequestTokens): string =>
	side === "deposit" ? tokens.shareToken : tokens.token

export const owedAmount = (
	side: RequestSide,
	amount: Amount,
	price: Price,
): Amount =>
	(side === "deposit"
		? (amount * WAD) / price
		: (amount * price) / WAD) as Amount

const hasValidPrice = (price: Price): boolean => price > 0n

const priceableFrom = (priceableAt: bigint): string =>
	`Prices from ${formatDayMonth(priceableAt)}`

const readyNote = (side: RequestSide): string =>
	side === "deposit"
		? "Claiming is not guaranteed to succeed. Compliance is checked when you sign."
		: "Claiming is not guaranteed to succeed. The reserve is checked when you sign."

export function allowlistRefusalFor(
	allowance: Allowance,
): (request: InvestorRequest) => ClaimRefusal | undefined {
	return (request) => {
		if (request.side !== "deposit") return undefined
		if (allowance !== "not-allowed") return undefined
		return {
			reason:
				"This address is not on the vault's allowlist, so it cannot receive shares right now.",
		}
	}
}

export function assignStage(
	request: InvestorRequest,
	refusal: ClaimRefusal | undefined,
): RequestStage {
	if (request.epochStatus.tag !== "Fulfilled") return "waiting"
	if (!hasValidPrice(request.sharePrice)) return "blocked"
	return refusal === undefined ? "ready" : "blocked"
}

const baseEntry = (
	request: InvestorRequest,
	tokens: RequestTokens,
): Pick<
	RequestEntry,
	"id" | "inLabel" | "inAmount" | "outLabel" | "actions"
> => ({
	id: `${request.side}-${request.epochId}`,
	inLabel: sideLabel[request.side],
	inAmount: `${formatScaled(request.amount, AMOUNT_DECIMALS)} ${inTicker(request.side, tokens)}`,
	outLabel: "Owed to you",
	actions: [],
})

function cancelAction(
	request: InvestorRequest,
	onCancel: (request: InvestorRequest) => void,
): RequestAction {
	return { label: "Cancel", kind: "ordinary", onPress: () => onCancel(request) }
}

function claimAction(
	request: InvestorRequest,
	onClaim: (request: InvestorRequest) => void,
): RequestAction {
	return { label: "Claim", kind: "primary", onPress: () => onClaim(request) }
}

function waitingEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
	onCancel: ((request: InvestorRequest) => void) | undefined,
): RequestEntry {
	const actions =
		onCancel !== undefined ? [cancelAction(request, onCancel)] : []
	return {
		...baseEntry(request, tokens),
		inMeta:
			request.epochStatus.tag === "Pending" && request.priceableAt !== 0n
				? priceableFrom(request.priceableAt)
				: undefined,
		actions,
		outAmount: "Not yet priced",
		outTone: "word",
		state: request.epochStatus.tag,
		tone: stageTone.waiting,
	}
}

function readyEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
	onClaim: ((request: InvestorRequest) => void) | undefined,
): RequestEntry {
	const owed = owedAmount(request.side, request.amount, request.sharePrice)
	const actions = onClaim !== undefined ? [claimAction(request, onClaim)] : []
	return {
		...baseEntry(request, tokens),
		actions,
		outAmount: `${formatScaled(owed, AMOUNT_DECIMALS)} ${outTicker(request.side, tokens)}`,
		outTone: "ok",
		state: "Priced",
		tone: stageTone.ready,
		note: readyNote(request.side),
	}
}

function blockedEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
	refusal: ClaimRefusal,
): RequestEntry {
	const owed = owedAmount(request.side, request.amount, request.sharePrice)
	return {
		...baseEntry(request, tokens),
		outAmount: `${formatScaled(owed, AMOUNT_DECIMALS)} ${outTicker(request.side, tokens)}`,
		outTone: "stop",
		state: "Blocked",
		tone: stageTone.blocked,
		tooltip: { label: "Why you cannot claim this yet", text: refusal.reason },
	}
}

function invalidPriceEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
): RequestEntry {
	return {
		...baseEntry(request, tokens),
		outAmount: "Could not read",
		outTone: "word",
		state: "Invalid price",
		tone: stageTone.blocked,
		tooltip: {
			label: "Why you cannot claim this yet",
			text: "The vault reported an invalid price for this request.",
		},
	}
}

export function toPresentEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
	refusal: ClaimRefusal | undefined,
	onCancel?: (request: InvestorRequest) => void,
	onClaim?: (request: InvestorRequest) => void,
): RequestEntry {
	const stage = assignStage(request, refusal)
	if (stage === "waiting") return waitingEntry(request, tokens, onCancel)
	if (!hasValidPrice(request.sharePrice))
		return invalidPriceEntry(request, tokens)
	if (stage === "blocked" && refusal !== undefined)
		return blockedEntry(request, tokens, refusal)
	return readyEntry(request, tokens, onClaim)
}

function archivedEntry(request: ArchivedRequest): RequestEntry {
	return {
		id: `${request.side}-${request.epochId}`,
		inLabel: sideLabel[request.side],
		inAmount: "Unknown amount",
		outLabel: "Owed to you",
		outAmount: "Could not read",
		outTone: "word",
		state: "Expired",
		tone: stageTone.blocked,
		actions: [],
		tooltip: {
			label: "Why you cannot claim this yet",
			text: "This request's record expired from storage and can no longer be read on chain.",
		},
	}
}

function unreadableEntry(request: UnreadableRequest): RequestEntry {
	return {
		id: `${request.side}-${request.epochId}`,
		inLabel: sideLabel[request.side],
		inAmount: "Unknown amount",
		outLabel: "Owed to you",
		outAmount: "Could not read",
		outTone: "word",
		state: "Could not read",
		tone: stageTone.blocked,
		actions: [],
		tooltip: {
			label: "Why you cannot claim this yet",
			text: "Could not read this request from the vault. Try again shortly.",
		},
	}
}

export function toRequestEntriesByStage(
	loaded: LoadedRequests,
	tokens: RequestTokens,
	refusalFor: (request: InvestorRequest) => ClaimRefusal | undefined = () =>
		undefined,
	onCancel?: (request: InvestorRequest) => void,
	onClaim?: (request: InvestorRequest) => void,
): EntriesByStage {
	const entries: EntriesByStage = { ready: [], blocked: [], waiting: [] }

	for (const request of loaded.requests) {
		if (request.claimed) continue
		const refusal = refusalFor(request)
		entries[assignStage(request, refusal)].push(
			toPresentEntry(request, tokens, refusal, onCancel, onClaim),
		)
	}
	for (const request of loaded.archived) {
		entries.blocked.push(archivedEntry(request))
	}
	for (const request of loaded.unreadable) {
		entries.blocked.push(unreadableEntry(request))
	}

	return entries
}

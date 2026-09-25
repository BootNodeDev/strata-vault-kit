import {
	AMOUNT_DECIMALS,
	type Amount,
	formatScaled,
	type Price,
} from "@stellar-scaffold/app-lib"
import {
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

const owedAmount = (side: RequestSide, amount: Amount, price: Price): Amount =>
	(side === "deposit"
		? (amount * WAD) / price
		: (amount * price) / WAD) as Amount

const hasValidPrice = (price: Price): boolean => price > 0n

const readyNote = (side: RequestSide): string =>
	side === "deposit"
		? "Claiming is not guaranteed to succeed. Compliance is checked when you sign."
		: "Claiming is not guaranteed to succeed. The reserve is checked when you sign."

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
	"id" | "inLabel" | "inAmount" | "inMeta" | "outLabel" | "actions"
> => ({
	id: `${request.side}-${request.epochId}`,
	inLabel: sideLabel[request.side],
	inAmount: `${formatScaled(request.amount, AMOUNT_DECIMALS)} ${inTicker(request.side, tokens)}`,
	inMeta: `Batch ${request.epochId}`,
	outLabel: "Owed to you",
	actions: [],
})

function waitingEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
): RequestEntry {
	return {
		...baseEntry(request, tokens),
		outAmount: "Not yet priced",
		outTone: "word",
		state: request.epochStatus.tag,
		tone: stageTone.waiting,
	}
}

function readyEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
): RequestEntry {
	const owed = owedAmount(request.side, request.amount, request.sharePrice)
	return {
		...baseEntry(request, tokens),
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
		outAmount: "Not readable",
		outTone: "word",
		state: "Invalid price",
		tone: stageTone.blocked,
		tooltip: {
			label: "Why you cannot claim this yet",
			text: "The vault reported an invalid price for this batch.",
		},
	}
}

export function toPresentEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
	refusal: ClaimRefusal | undefined,
): RequestEntry {
	const stage = assignStage(request, refusal)
	if (stage === "waiting") return waitingEntry(request, tokens)
	if (!hasValidPrice(request.sharePrice))
		return invalidPriceEntry(request, tokens)
	if (stage === "blocked" && refusal !== undefined)
		return blockedEntry(request, tokens, refusal)
	return readyEntry(request, tokens)
}

function archivedEntry(request: ArchivedRequest): RequestEntry {
	return {
		id: `${request.side}-${request.epochId}`,
		inLabel: sideLabel[request.side],
		inAmount: "Unknown amount",
		inMeta: `Batch ${request.epochId}`,
		outLabel: "Owed to you",
		outAmount: "Not readable",
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
		inMeta: `Batch ${request.epochId}`,
		outLabel: "Owed to you",
		outAmount: "Not readable",
		outTone: "word",
		state: "Unreadable",
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
): EntriesByStage {
	const entries: EntriesByStage = { ready: [], blocked: [], waiting: [] }

	for (const request of loaded.requests) {
		if (request.claimed) continue
		const refusal = refusalFor(request)
		entries[assignStage(request, refusal)].push(
			toPresentEntry(request, tokens, refusal),
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

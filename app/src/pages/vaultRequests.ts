import {
	AMOUNT_DECIMALS,
	type Amount,
	formatDayMonth,
	formatExact,
	type Price,
} from "@stellar-scaffold/app-lib"
import {
	type RequestAction,
	type RequestEntry,
	type RequestStage,
	type RequestTone,
} from "../components/vault/RequestCard"
import {
	HELD_WHILE_FROZEN,
	NOT_ALLOWLISTED,
} from "../components/vault/TransactionModal"
import {
	type ArchivedRequest,
	type InvestorRequest,
	type RequestSide,
	type UnreadableRequest,
} from "../hooks/useInvestorRequests"
import { type Allowance } from "../hooks/useIsAllowed"
import { type NavClassification } from "../hooks/useNavPrice"
import { type PauseState } from "../hooks/useVaultPaused"

export type RequestTokens = { token: string; shareToken: string }

export type RequestOutlook = {
	held?: string
	claimNote?: string
	cancellable: boolean
}

export type HolderInputs = {
	allowance: Allowance
	frozen: boolean | null
	windingDown: boolean | null
	pause: PauseState
	nav: NavClassification | undefined
}

export type RequestHandlers = {
	outlookFor?: (request: InvestorRequest) => RequestOutlook
	onCancel?: (request: InvestorRequest) => void
	onClaim?: (request: InvestorRequest) => void
}

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

const isPriced = (request: InvestorRequest): boolean =>
	request.epochStatus.tag === "Fulfilled"

const priceReadable = (
	request: InvestorRequest,
	{ pause, nav }: HolderInputs,
): boolean =>
	request.epochStatus.tag === "Pending" &&
	pause === "open" &&
	nav?.status === "valid" &&
	nav.attestedAt >= request.closedAt

const cancellable = (
	request: InvestorRequest,
	inputs: HolderInputs,
): boolean => {
	const windingDown = inputs.windingDown === true
	if (isPriced(request)) return false
	if (!windingDown && priceReadable(request, inputs)) return false
	return !(
		request.side === "redeem" &&
		inputs.allowance === "not-allowed" &&
		!windingDown
	)
}

const delistedClaimNote = (windingDown: boolean): string =>
	windingDown
		? `${NOT_ALLOWLISTED} Claiming does not send you shares. They move into your wind-down claim instead.`
		: `${NOT_ALLOWLISTED} Claiming does not send you shares. They are queued as a redemption that pays out at the next price.`

export function outlookFor(
	inputs: HolderInputs,
): (request: InvestorRequest) => RequestOutlook {
	return (request) => {
		if (inputs.frozen === true)
			return { held: HELD_WHILE_FROZEN, cancellable: false }
		const outlook: RequestOutlook = {
			cancellable: cancellable(request, inputs),
		}
		if (request.side === "deposit" && inputs.allowance === "not-allowed")
			outlook.claimNote = delistedClaimNote(inputs.windingDown === true)
		return outlook
	}
}

export function assignStage(
	request: InvestorRequest,
	outlook: RequestOutlook | undefined,
): RequestStage {
	if (outlook?.held !== undefined) return "blocked"
	if (!isPriced(request)) return "waiting"
	return hasValidPrice(request.sharePrice) ? "ready" : "blocked"
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
	inAmount: `${formatExact(request.amount, AMOUNT_DECIMALS)} ${inTicker(request.side, tokens)}`,
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
	claimNote: string | undefined,
): RequestEntry {
	const owed = owedAmount(request.side, request.amount, request.sharePrice)
	const actions = onClaim !== undefined ? [claimAction(request, onClaim)] : []
	return {
		...baseEntry(request, tokens),
		actions,
		outAmount: `${formatExact(owed, AMOUNT_DECIMALS)} ${outTicker(request.side, tokens)}`,
		outTone: "ok",
		state: "Priced",
		tone: stageTone.ready,
		note: claimNote ?? readyNote(request.side),
	}
}

function heldEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
	reason: string,
): RequestEntry {
	const owed =
		isPriced(request) && hasValidPrice(request.sharePrice)
			? owedAmount(request.side, request.amount, request.sharePrice)
			: null
	return {
		...baseEntry(request, tokens),
		outAmount:
			owed === null
				? "Not yet priced"
				: `${formatExact(owed, AMOUNT_DECIMALS)} ${outTicker(request.side, tokens)}`,
		outTone: owed === null ? "word" : "stop",
		state: "Held",
		tone: stageTone.blocked,
		tooltip: { label: "Why this request is held", text: reason },
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

function toPresentEntry(
	request: InvestorRequest,
	tokens: RequestTokens,
	outlook: RequestOutlook,
	{ onCancel, onClaim }: RequestHandlers,
): RequestEntry {
	if (outlook.held !== undefined)
		return heldEntry(request, tokens, outlook.held)
	if (!isPriced(request))
		return waitingEntry(
			request,
			tokens,
			outlook.cancellable ? onCancel : undefined,
		)
	if (!hasValidPrice(request.sharePrice))
		return invalidPriceEntry(request, tokens)
	return readyEntry(request, tokens, onClaim, outlook.claimNote)
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

const OPEN_OUTLOOK: RequestOutlook = { cancellable: true }

export function toRequestEntriesByStage(
	loaded: LoadedRequests,
	tokens: RequestTokens,
	handlers: RequestHandlers = {},
): EntriesByStage {
	const entries: EntriesByStage = { ready: [], blocked: [], waiting: [] }

	for (const request of loaded.requests) {
		if (request.claimed) continue
		const outlook = handlers.outlookFor?.(request) ?? OPEN_OUTLOOK
		entries[assignStage(request, outlook)].push(
			toPresentEntry(request, tokens, outlook, handlers),
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

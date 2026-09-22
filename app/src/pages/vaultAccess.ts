import {
	AMOUNT_DECIMALS,
	formatScaled,
	toSafeNumber,
	type NetworkState,
} from "@stellar-scaffold/app-lib"
import { type ActionPanelBlock } from "../components/vault/ActionPanel"
import { type DepositBalance } from "../hooks/useDepositBalance"
import { type Allowance } from "../hooks/useIsAllowed"
import { type NavClassification } from "../hooks/useNavPrice"
import { type SharePosition } from "../hooks/useSharePosition"

export type InvestorAccess =
	| { status: "disconnected" }
	| { status: "wrong-network"; appNetwork: string; walletNetwork: string }
	| { status: "checking" }
	| { status: "not-allowed" }
	| { status: "unreadable" }
	| { status: "allowed" }

export function deriveAccess(input: {
	address: string | undefined
	network: { state: NetworkState; appNetwork: string; walletNetwork: string }
	allowance: Allowance
}): InvestorAccess {
	const { address, network, allowance } = input

	if (address === undefined) return { status: "disconnected" }
	if (network.state === "mismatch") {
		return {
			status: "wrong-network",
			appNetwork: network.appNetwork,
			walletNetwork: network.walletNetwork,
		}
	}
	if (allowance === "checking") return { status: "checking" }
	if (allowance === "not-allowed") return { status: "not-allowed" }
	if (allowance === "unreadable") return { status: "unreadable" }
	return { status: "allowed" }
}

export function toPanelBlock(
	access: InvestorAccess,
	onConnect: () => void,
	onOpenWallet: () => void,
): ActionPanelBlock | undefined {
	switch (access.status) {
		case "disconnected":
			return {
				kind: "action",
				reason: "Connect a wallet to subscribe or redeem.",
				label: "Connect Wallet",
				onPress: onConnect,
			}
		case "wrong-network":
			return {
				kind: "action",
				reason: `Your wallet is on ${access.walletNetwork}. Switch it to ${access.appNetwork} in your wallet to continue.`,
				label: `Switch to ${access.appNetwork}`,
				onPress: onOpenWallet,
			}
		case "checking":
			return {
				kind: "message",
				reason: "Checking whether this address may subscribe.",
			}
		case "not-allowed":
			return {
				kind: "message",
				reason:
					"This address is not on the vault's allowlist. The vault's operator grants access.",
			}
		case "unreadable":
			return {
				kind: "message",
				reason:
					"Could not check whether this address may subscribe. Try again shortly.",
			}
		case "allowed":
			return undefined
	}
}

export function toPriceBlock(
	nav: NavClassification | undefined,
	isPending: boolean,
): ActionPanelBlock | undefined {
	if (isPending) {
		return { kind: "message", reason: "Reading the vault's price." }
	}
	if (nav?.status === "valid") return undefined
	return {
		kind: "message",
		reason:
			"The vault's price is not valid right now, so subscribing and redeeming are closed.",
	}
}

export function toPosition(
	position: SharePosition,
	shareSymbol: string,
): {
	value: string | null
	note?: string
	pending?: boolean
} {
	switch (position.status) {
		case "disconnected":
			return { value: null, note: "Connect a wallet to see your position." }
		case "checking":
			return { value: null, pending: true }
		case "unreadable":
			return { value: null, note: "Could not read your share balance." }
		case "held":
			return {
				value: `${formatScaled(position.shares, AMOUNT_DECIMALS)} ${shareSymbol}`,
			}
	}
}

export function toActionBalance(
	isSubscribe: boolean,
	blocked: boolean,
	deposit: DepositBalance,
	shares: SharePosition,
): number | null {
	if (blocked) return null
	if (isSubscribe) {
		return deposit.status === "held" ? toSafeNumber(deposit.amount) : null
	}
	return shares.status === "held" ? toSafeNumber(shares.shares) : null
}

export function emptyMessages(connected: boolean): {
	ready: string
	waiting: string
} {
	return connected
		? {
				ready:
					"Nothing to claim yet. A request appears here once it is priced, and for cash, once the reserve covers it in full.",
				waiting:
					"Nothing is waiting. A request you make appears here until it is claimable.",
			}
		: {
				ready: "Connect a wallet to see requests you can claim.",
				waiting: "Connect a wallet to see requests that are waiting.",
			}
}

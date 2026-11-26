import { type Signer } from "@stellar-scaffold/app-lib"
import { identityRegistryWriter, shareTokenWriter } from "../config/clients"
import { adminTransaction } from "./useAdminTransaction"
import { complianceReadsKey } from "./useComplianceState"
import { legalTransfersKey } from "./useCycleState"
import { identityRegistryOf } from "./useIdentityRegistry"
import { isAllowedKey } from "./useIsAllowed"

export type AllowanceChange = { verifier: string; account: string }
export type SharesChange = { account: string; amount: bigint }
export type LegalTransferOrder = {
	from: string
	to: string
	amount: bigint
	reference: string
}

const SHARE_BALANCES_KEY = ["share", "balance"] as const

const listingCall =
	(method: "remove_identity" | "lift_veto") =>
	async (signer: Signer, { verifier, account }: AllowanceChange) => {
		const registry = await identityRegistryOf(verifier)
		const client = await identityRegistryWriter(registry)(signer)
		return client[method]({ account, operator: signer.publicKey })
	}

const freezeAddressCall =
	(freeze: boolean) => (signer: Signer, account: string) =>
		shareTokenWriter(signer).then((token) =>
			token.set_address_frozen({
				user_address: account,
				freeze,
				operator: signer.publicKey,
			}),
		)

const sharesCall =
	(method: "freeze_partial_tokens" | "unfreeze_partial_tokens") =>
	(signer: Signer, { account, amount }: SharesChange) =>
		shareTokenWriter(signer).then((token) =>
			token[method]({
				user_address: account,
				amount,
				operator: signer.publicKey,
			}),
		)

const legalTransferCall = (signer: Signer, order: LegalTransferOrder) =>
	shareTokenWriter(signer).then((token) =>
		token.legal_transfer({ ...order, caller: signer.publicKey }),
	)

const allowKeys = [complianceReadsKey, isAllowedKey]

export const useAllowAddress = adminTransaction(
	listingCall("lift_veto"),
	allowKeys,
)
export const useDisallowAddress = adminTransaction(
	listingCall("remove_identity"),
	allowKeys,
)
export const useFreezeAddress = adminTransaction(freezeAddressCall(true), [
	complianceReadsKey,
])
export const useUnfreezeAddress = adminTransaction(freezeAddressCall(false), [
	complianceReadsKey,
])
export const useFreezeShares = adminTransaction(
	sharesCall("freeze_partial_tokens"),
	[complianceReadsKey],
)
export const useUnfreezeShares = adminTransaction(
	sharesCall("unfreeze_partial_tokens"),
	[complianceReadsKey],
)
export const useLegalTransfer = adminTransaction(legalTransferCall, [
	complianceReadsKey,
	SHARE_BALANCES_KEY,
	legalTransfersKey,
])

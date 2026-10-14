import { type Signer } from "@stellar-scaffold/app-lib"
import { identityVerifierWriter, shareTokenWriter } from "../config/clients"
import { adminTransaction } from "./useAdminTransaction"
import { complianceReadsKey } from "./useComplianceState"
import { isAllowedKey } from "./useIsAllowed"

export type AllowanceChange = { verifier: string; account: string }
export type SharesChange = { account: string; amount: bigint }
export type ForcedTransfer = { from: string; to: string; amount: bigint }

const SHARE_BALANCES_KEY = ["share", "balance"] as const

const allowCall =
	(allowed: boolean) =>
	(signer: Signer, { verifier, account }: AllowanceChange) =>
		identityVerifierWriter(verifier)(signer).then((client) =>
			client.allow({ account, allowed, caller: signer.publicKey }),
		)

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

const forcedTransferCall = (signer: Signer, transfer: ForcedTransfer) =>
	shareTokenWriter(signer).then((token) =>
		token.forced_transfer({ ...transfer, operator: signer.publicKey }),
	)

const allowKeys = [complianceReadsKey, isAllowedKey]

export const useAllowAddress = adminTransaction(allowCall(true), allowKeys)
export const useDisallowAddress = adminTransaction(allowCall(false), allowKeys)
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
export const useForceTransfer = adminTransaction(forcedTransferCall, [
	complianceReadsKey,
	SHARE_BALANCES_KEY,
])

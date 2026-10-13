import { type AsyncVaultApi, type Signer } from "@stellar-scaffold/app-lib"
import { type QueryKey } from "@tanstack/react-query"
import {
	asyncVaultWriter,
	navOracleWriter,
	shareTokenWriter,
} from "../config/clients"
import { adminAuthorityKey } from "./useAdminAuthority"
import { adminTransaction } from "./useAdminTransaction"
import { governanceReadsKey } from "./useGovernanceState"
import { vaultAuthoritiesKey } from "./useVaultAuthorities"

export type RoleChange = { role: string; account: string }

type RoleClient = Pick<AsyncVaultApi, "grant_role" | "revoke_role">

const roleChange = (
	connect: (signer: Signer) => Promise<RoleClient>,
	method: keyof RoleClient,
	keys: readonly QueryKey[],
) =>
	adminTransaction(
		(signer: Signer, { role, account }: RoleChange) =>
			connect(signer).then((client) =>
				client[method]({ account, role, caller: signer.publicKey }),
			),
		keys,
	)

const VAULT_KEYS = [adminAuthorityKey, vaultAuthoritiesKey]

export const useGrantVaultRole = roleChange(
	asyncVaultWriter,
	"grant_role",
	VAULT_KEYS,
)
export const useRevokeVaultRole = roleChange(
	asyncVaultWriter,
	"revoke_role",
	VAULT_KEYS,
)
export const useGrantOracleRole = roleChange(navOracleWriter, "grant_role", [
	adminAuthorityKey,
])
export const useRevokeOracleRole = roleChange(navOracleWriter, "revoke_role", [
	adminAuthorityKey,
])
export const useGrantTokenRole = roleChange(shareTokenWriter, "grant_role", [
	adminAuthorityKey,
])
export const useRevokeTokenRole = roleChange(shareTokenWriter, "revoke_role", [
	adminAuthorityKey,
])

export type AdminOffer = { newAdmin: string; liveUntilLedger: number }

type AdminClient = Pick<
	AsyncVaultApi,
	"transfer_admin_role" | "accept_admin_transfer"
>

type Connect = (signer: Signer) => Promise<AdminClient>

const offerAdmin = (connect: Connect, keys: readonly QueryKey[]) =>
	adminTransaction(
		(signer: Signer, { newAdmin, liveUntilLedger }: AdminOffer) =>
			connect(signer).then((client) =>
				client.transfer_admin_role({
					new_admin: newAdmin,
					live_until_ledger: liveUntilLedger,
				}),
			),
		keys,
	)

const acceptAdmin = (connect: Connect, keys: readonly QueryKey[]) =>
	adminTransaction(
		(signer: Signer) =>
			connect(signer).then((client) => client.accept_admin_transfer()),
		keys,
	)

const VAULT_HANDOVER_KEYS = [governanceReadsKey, ...VAULT_KEYS]
const HANDOVER_KEYS = [governanceReadsKey, adminAuthorityKey]

export const useHandOverVaultAdmin = offerAdmin(
	asyncVaultWriter,
	VAULT_HANDOVER_KEYS,
)
export const useCancelVaultHandover = offerAdmin(
	asyncVaultWriter,
	VAULT_HANDOVER_KEYS,
)
export const useAcceptVaultAdmin = acceptAdmin(
	asyncVaultWriter,
	VAULT_HANDOVER_KEYS,
)
export const useHandOverOracleAdmin = offerAdmin(navOracleWriter, HANDOVER_KEYS)
export const useCancelOracleHandover = offerAdmin(
	navOracleWriter,
	HANDOVER_KEYS,
)
export const useAcceptOracleAdmin = acceptAdmin(navOracleWriter, HANDOVER_KEYS)
export const useHandOverTokenAdmin = offerAdmin(shareTokenWriter, HANDOVER_KEYS)
export const useCancelTokenHandover = offerAdmin(
	shareTokenWriter,
	HANDOVER_KEYS,
)
export const useAcceptTokenAdmin = acceptAdmin(shareTokenWriter, HANDOVER_KEYS)

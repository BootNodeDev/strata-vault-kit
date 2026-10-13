import { type AsyncVaultApi, type Signer } from "@stellar-scaffold/app-lib"
import { type QueryKey } from "@tanstack/react-query"
import {
	asyncVaultWriter,
	navOracleWriter,
	shareTokenWriter,
} from "../config/clients"
import { adminAuthorityKey } from "./useAdminAuthority"
import { adminTransaction } from "./useAdminTransaction"
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

import { Buffer } from "buffer"
import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import {
	type AsyncVaultApi,
	type Signer,
	type TokenChange,
	type VaultChange,
} from "@stellar-scaffold/app-lib"
import { type QueryKey } from "@tanstack/react-query"
import {
	asyncVaultWriter,
	navOracleWriter,
	shareTokenWriter,
} from "../config/clients"
import { governanceReadsKey } from "./pendingAdmins"
import { adminAuthorityKey } from "./useAdminAuthority"
import { adminTransaction } from "./useAdminTransaction"
import { configurationReadsKey } from "./useConfigurationState"
import { cycleReadsKey } from "./useCycleState"
import { pendingChangesKey } from "./useGovernanceState"
import { isAllowedKey } from "./useIsAllowed"
import { type TimelockedContract } from "./useSetupOpen"
import { vaultAuthoritiesKey } from "./useVaultAuthorities"

export type RoleChange = { role: string; account: string }

type ChangeClient<Change> = Pick<
	AsyncVaultApi,
	"apply_change" | "cancel_change"
> & {
	propose_change: (args: {
		change: Change
	}) => Promise<AssembledTransaction<number>>
}

const timelock = <Change>(
	contract: TimelockedContract,
	connect: (signer: Signer) => Promise<ChangeClient<Change>>,
) => ({
	propose: <TArg>(
		toChange: (arg: TArg) => Change,
		keys: readonly QueryKey[] = [],
	) =>
		adminTransaction(
			(signer: Signer, arg: TArg) =>
				connect(signer).then((client) =>
					client.propose_change({ change: toChange(arg) }),
				),
			[pendingChangesKey(contract), ...keys],
		),
	apply: (keys: readonly QueryKey[]) =>
		adminTransaction(
			(signer: Signer, id: number) =>
				connect(signer).then((client) => client.apply_change({ id })),
			[pendingChangesKey(contract), ...keys],
		),
	cancel: adminTransaction(
		(signer: Signer, id: number) =>
			connect(signer).then((client) => client.cancel_change({ id })),
		[pendingChangesKey(contract)],
	),
})

const vaultTimelock = timelock<VaultChange>("vault", asyncVaultWriter)
const tokenTimelock = timelock<TokenChange>("token", shareTokenWriter)

export const proposeVaultChange = vaultTimelock.propose
export const proposeTokenChange = tokenTimelock.propose

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

export const useProposeCodeUpgrade = proposeVaultChange(
	(hash: string) => ({ tag: "Upgrade", values: [Buffer.from(hash, "hex")] }),
	[configurationReadsKey],
)

export const useProposeUpgradeDelay = proposeVaultChange(
	(secs: bigint) => ({ tag: "UpgradeDelay", values: [secs] }),
	[configurationReadsKey],
)

const grantRole = ({ role, account }: RoleChange) => ({
	tag: "GrantRole" as const,
	values: [role, account] as const,
})

const revokeRole = ({ role, account }: RoleChange) => ({
	tag: "RevokeRole" as const,
	values: [role, account] as const,
})

const admin = (account: string) => ({
	tag: "Admin" as const,
	values: [account] as const,
})

export const useProposeGrantRole = proposeVaultChange(grantRole)
export const useProposeRevokeRole = proposeVaultChange(revokeRole)
export const useProposeAdmin = proposeVaultChange(admin)
export const useProposeTokenGrantRole = proposeTokenChange(grantRole)
export const useProposeTokenRevokeRole = proposeTokenChange(revokeRole)
export const useProposeTokenAdmin = proposeTokenChange(admin)

export const useApplyChange = vaultTimelock.apply([
	configurationReadsKey,
	cycleReadsKey,
	...VAULT_HANDOVER_KEYS,
])
export const useCancelChange = vaultTimelock.cancel

export const useApplyTokenChange = tokenTimelock.apply([
	configurationReadsKey,
	...HANDOVER_KEYS,
	isAllowedKey,
])
export const useCancelTokenChange = tokenTimelock.cancel

export const useProposeWindDown = adminTransaction(
	(signer: Signer) =>
		asyncVaultWriter(signer).then((vault) => vault.propose_wind_down()),
	[cycleReadsKey],
)

export const useCancelWindDown = adminTransaction(
	(signer: Signer) =>
		asyncVaultWriter(signer).then((vault) => vault.cancel_wind_down_proposal()),
	[cycleReadsKey],
)

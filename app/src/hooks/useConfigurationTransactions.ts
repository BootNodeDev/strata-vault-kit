import { type NavOracleApi, type Signer } from "@stellar-scaffold/app-lib"
import {
	asyncVaultWriter,
	navOracleWriter,
	shareTokenWriter,
} from "../config/clients"
import { adminAuthorityKey } from "./useAdminAuthority"
import { adminTransaction } from "./useAdminTransaction"
import { configurationReadsKey } from "./useConfigurationState"
import { cycleReadsKey } from "./useCycleState"
import { isAllowedKey } from "./useIsAllowed"
import { oracleWriteKeys } from "./useOracleState"
import { vaultAuthoritiesKey } from "./useVaultAuthorities"

export type OracleConfig = Parameters<NavOracleApi["set_config"]>[0]["config"]

export const useSetDepositCap = adminTransaction(
	(signer: Signer, cap: bigint | null) =>
		asyncVaultWriter(signer).then((vault) => vault.set_deposit_cap({ cap })),
	[cycleReadsKey],
)

export const useSetCustodian = adminTransaction(
	(signer: Signer, custodian: string) =>
		asyncVaultWriter(signer).then((vault) =>
			vault.set_custodian({ custodian }),
		),
	[vaultAuthoritiesKey],
)

export const useSetNotice = adminTransaction(
	(signer: Signer, secs: bigint) =>
		asyncVaultWriter(signer).then((vault) => vault.set_notice({ secs })),
	[cycleReadsKey],
)

export const useSetWindDownDelay = adminTransaction(
	(signer: Signer, secs: bigint) =>
		asyncVaultWriter(signer).then((vault) =>
			vault.set_wind_down_delay({ secs }),
		),
	[cycleReadsKey],
)

export const useSetOracleConfig = adminTransaction(
	(signer: Signer, config: OracleConfig) =>
		navOracleWriter(signer).then((oracle) => oracle.set_config({ config })),
	oracleWriteKeys,
)

export const useSetCompliance = adminTransaction(
	(signer: Signer, compliance: string) =>
		shareTokenWriter(signer).then((token) =>
			token.set_compliance({ compliance, operator: signer.publicKey }),
		),
	[configurationReadsKey, isAllowedKey],
)

export const useSetIdentityVerifier = adminTransaction(
	(signer: Signer, identity_verifier: string) =>
		shareTokenWriter(signer).then((token) =>
			token.set_identity_verifier({
				identity_verifier,
				operator: signer.publicKey,
			}),
		),
	[configurationReadsKey, adminAuthorityKey, isAllowedKey],
)

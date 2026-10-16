import { Buffer } from "buffer"
import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { governanceReadsKey } from "./pendingAdmins"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { adminAuthorityKey } from "./useAdminAuthority"
import { complianceReadsKey } from "./useComplianceState"
import {
	useAllowAddress,
	useDisallowAddress,
	useForceTransfer,
	useFreezeAddress,
	useFreezeShares,
	useUnfreezeAddress,
	useUnfreezeShares,
} from "./useComplianceTransactions"
import { configurationReadsKey } from "./useConfigurationState"
import {
	useSetCompliance,
	useSetCustodian,
	useSetDepositCap,
	useSetIdentityVerifier,
	useSetNotice,
	useSetOracleConfig,
	useSetWindDownDelay,
} from "./useConfigurationTransactions"
import { cycleReadsKey } from "./useCycleState"
import {
	useClearLatest,
	usePauseToken,
	usePauseVault,
	useRaiseRipcord,
	useSetRipcord,
	useUnpauseToken,
	useUnpauseVault,
} from "./useEmergencyTransactions"
import { upgradeProposalKey } from "./useGovernanceState"
import {
	useAcceptOracleAdmin,
	useAcceptTokenAdmin,
	useAcceptVaultAdmin,
	useApplyUpgrade,
	useCancelOracleHandover,
	useCancelTokenHandover,
	useCancelUpgrade,
	useCancelVaultHandover,
	useCancelWindDown,
	useGrantOracleRole,
	useGrantTokenRole,
	useGrantVaultRole,
	useHandOverOracleAdmin,
	useHandOverTokenAdmin,
	useHandOverVaultAdmin,
	useProposeCodeUpgrade,
	useProposeUpgradeDelay,
	useProposeWindDown,
	useRevokeOracleRole,
	useRevokeTokenRole,
	useRevokeVaultRole,
} from "./useGovernanceTransactions"
import { isAllowedKey } from "./useIsAllowed"
import { oracleWriteKeys } from "./useOracleState"
import { tokenPausedKey } from "./useTokenPaused"
import { vaultAuthoritiesKey } from "./useVaultAuthorities"
import { vaultPausedKey } from "./useVaultPaused"

const { vault, token, oracle, verifier, verifierWriterMock } = vi.hoisted(
	() => ({
		vault: {
			pause: vi.fn(),
			unpause: vi.fn(),
			set_deposit_cap: vi.fn(),
			set_custodian: vi.fn(),
			set_notice: vi.fn(),
			set_wind_down_delay: vi.fn(),
			grant_role: vi.fn(),
			revoke_role: vi.fn(),
			transfer_admin_role: vi.fn(),
			accept_admin_transfer: vi.fn(),
			propose_upgrade: vi.fn(),
			propose_upgrade_delay: vi.fn(),
			apply_upgrade: vi.fn(),
			cancel_upgrade: vi.fn(),
			propose_wind_down: vi.fn(),
			cancel_wind_down_proposal: vi.fn(),
		},
		token: {
			pause: vi.fn(),
			unpause: vi.fn(),
			set_compliance: vi.fn(),
			set_identity_verifier: vi.fn(),
			grant_role: vi.fn(),
			revoke_role: vi.fn(),
			transfer_admin_role: vi.fn(),
			accept_admin_transfer: vi.fn(),
			set_address_frozen: vi.fn(),
			freeze_partial_tokens: vi.fn(),
			unfreeze_partial_tokens: vi.fn(),
			forced_transfer: vi.fn(),
		},
		verifier: { allow: vi.fn() },
		verifierWriterMock: vi.fn(),
		oracle: {
			raise_ripcord: vi.fn(),
			set_ripcord: vi.fn(),
			clear_latest: vi.fn(),
			set_config: vi.fn(),
			grant_role: vi.fn(),
			revoke_role: vi.fn(),
			transfer_admin_role: vi.fn(),
			accept_admin_transfer: vi.fn(),
		},
	}),
)

vi.mock("../config/clients", () => ({
	asyncVaultWriter: async () => vault,
	shareTokenWriter: async () => token,
	navOracleWriter: async () => oracle,
	identityVerifierWriter: verifierWriterMock,
}))

const CONTRACT = "CCONTRACTADDRESS1234567890"
const ORACLE_CONFIG = {
	freshness_duration: 86_400n,
	cooldown_secs: 3_600n,
	max_up_bps: 1_000,
	max_down_bps: null,
	min_answer: 1n,
	max_answer: 10n,
}

type Case = {
	name: string
	useHook: () => {
		status: unknown
		submit: (arg: never) => boolean
	}
	method: ReturnType<typeof vi.fn>
	arg: unknown
	args?: object
	keys: readonly (readonly string[])[]
	refusal: number
}

const cases: Case[] = [
	{
		name: "usePauseVault",
		useHook: usePauseVault,
		method: vault.pause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [vaultPausedKey],
		refusal: 1000,
	},
	{
		name: "useUnpauseVault",
		useHook: useUnpauseVault,
		method: vault.unpause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [vaultPausedKey],
		refusal: 1001,
	},
	{
		name: "usePauseToken",
		useHook: usePauseToken,
		method: token.pause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [tokenPausedKey],
		refusal: 1000,
	},
	{
		name: "useUnpauseToken",
		useHook: useUnpauseToken,
		method: token.unpause,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [tokenPausedKey],
		refusal: 1001,
	},
	{
		name: "useRaiseRipcord",
		useHook: useRaiseRipcord,
		method: oracle.raise_ripcord,
		arg: undefined,
		args: { caller: investorAddress },
		keys: oracleWriteKeys,
		refusal: 2000,
	},
	{
		name: "useClearLatest",
		useHook: useClearLatest,
		method: oracle.clear_latest,
		arg: undefined,
		args: { caller: investorAddress },
		keys: oracleWriteKeys,
		refusal: 3008,
	},
	{
		name: "useSetRipcord",
		useHook: useSetRipcord,
		method: oracle.set_ripcord,
		arg: false,
		args: { paused: false, caller: investorAddress },
		keys: oracleWriteKeys,
		refusal: 2000,
	},
	{
		name: "useSetDepositCap",
		useHook: useSetDepositCap,
		method: vault.set_deposit_cap,
		arg: null,
		args: { cap: null, caller: investorAddress },
		keys: [cycleReadsKey],
		refusal: 6007,
	},
	{
		name: "useSetCustodian",
		useHook: useSetCustodian,
		method: vault.set_custodian,
		arg: CONTRACT,
		args: { custodian: CONTRACT, caller: investorAddress },
		keys: [vaultAuthoritiesKey],
		refusal: 2000,
	},
	{
		name: "useSetNotice",
		useHook: useSetNotice,
		method: vault.set_notice,
		arg: 86_400n,
		args: { secs: 86_400n, caller: investorAddress },
		keys: [cycleReadsKey],
		refusal: 6061,
	},
	{
		name: "useSetWindDownDelay",
		useHook: useSetWindDownDelay,
		method: vault.set_wind_down_delay,
		arg: 86_400n,
		args: { secs: 86_400n, caller: investorAddress },
		keys: [cycleReadsKey],
		refusal: 6053,
	},
	{
		name: "useSetOracleConfig",
		useHook: useSetOracleConfig,
		method: oracle.set_config,
		arg: ORACLE_CONFIG,
		args: { config: ORACLE_CONFIG },
		keys: oracleWriteKeys,
		refusal: 3001,
	},
	{
		name: "useSetCompliance",
		useHook: useSetCompliance,
		method: token.set_compliance,
		arg: CONTRACT,
		args: { compliance: CONTRACT, operator: investorAddress },
		keys: [configurationReadsKey, isAllowedKey],
		refusal: 2000,
	},
	{
		name: "useSetIdentityVerifier",
		useHook: useSetIdentityVerifier,
		method: token.set_identity_verifier,
		arg: CONTRACT,
		args: { identity_verifier: CONTRACT, operator: investorAddress },
		keys: [configurationReadsKey, adminAuthorityKey, isAllowedKey],
		refusal: 2000,
	},
]

const ROLE_CHANGE = { role: "guardian", account: CONTRACT }
const OFFER = { newAdmin: CONTRACT, liveUntilLedger: 1_234 }
const WASM_HASH = "ab".repeat(32)

type Hook = Case["useHook"]

const governedContracts: {
	name: string
	client: typeof vault | typeof token | typeof oracle
	hooks: Record<"grant" | "revoke" | "handOver" | "cancel" | "accept", Hook>
	roleKeys: Case["keys"]
	handoverKeys: Case["keys"]
}[] = [
	{
		name: "Vault",
		client: vault,
		hooks: {
			grant: useGrantVaultRole,
			revoke: useRevokeVaultRole,
			handOver: useHandOverVaultAdmin,
			cancel: useCancelVaultHandover,
			accept: useAcceptVaultAdmin,
		},
		roleKeys: [adminAuthorityKey, vaultAuthoritiesKey],
		handoverKeys: [governanceReadsKey, adminAuthorityKey, vaultAuthoritiesKey],
	},
	{
		name: "Oracle",
		client: oracle,
		hooks: {
			grant: useGrantOracleRole,
			revoke: useRevokeOracleRole,
			handOver: useHandOverOracleAdmin,
			cancel: useCancelOracleHandover,
			accept: useAcceptOracleAdmin,
		},
		roleKeys: [adminAuthorityKey],
		handoverKeys: [governanceReadsKey, adminAuthorityKey],
	},
	{
		name: "Token",
		client: token,
		hooks: {
			grant: useGrantTokenRole,
			revoke: useRevokeTokenRole,
			handOver: useHandOverTokenAdmin,
			cancel: useCancelTokenHandover,
			accept: useAcceptTokenAdmin,
		},
		roleKeys: [adminAuthorityKey],
		handoverKeys: [governanceReadsKey, adminAuthorityKey],
	},
]

const roleArgs = {
	account: CONTRACT,
	role: "guardian",
	caller: investorAddress,
}

const governanceCases: Case[] = [
	...governedContracts.flatMap(
		({ name, client, hooks, roleKeys, handoverKeys }): Case[] => [
			{
				name: `useGrant${name}Role`,
				useHook: hooks.grant,
				method: client.grant_role,
				arg: ROLE_CHANGE,
				args: roleArgs,
				keys: roleKeys,
				refusal: 2000,
			},
			{
				name: `useRevoke${name}Role`,
				useHook: hooks.revoke,
				method: client.revoke_role,
				arg: ROLE_CHANGE,
				args: roleArgs,
				keys: roleKeys,
				refusal: 2007,
			},
			{
				name: `useHandOver${name}Admin`,
				useHook: hooks.handOver,
				method: client.transfer_admin_role,
				arg: OFFER,
				args: { new_admin: CONTRACT, live_until_ledger: 1_234 },
				keys: handoverKeys,
				refusal: 2201,
			},
			{
				name: `useCancel${name}Handover`,
				useHook: hooks.cancel,
				method: client.transfer_admin_role,
				arg: { ...OFFER, liveUntilLedger: 0 },
				args: { new_admin: CONTRACT, live_until_ledger: 0 },
				keys: handoverKeys,
				refusal: 2200,
			},
			{
				name: `useAccept${name}Admin`,
				useHook: hooks.accept,
				method: client.accept_admin_transfer,
				arg: undefined,
				keys: handoverKeys,
				refusal: 2202,
			},
		],
	),
	{
		name: "useProposeCodeUpgrade",
		useHook: useProposeCodeUpgrade,
		method: vault.propose_upgrade,
		arg: WASM_HASH,
		args: { wasm_hash: Buffer.alloc(32, 0xab), caller: investorAddress },
		keys: [upgradeProposalKey, configurationReadsKey],
		refusal: 6055,
	},
	{
		name: "useProposeUpgradeDelay",
		useHook: useProposeUpgradeDelay,
		method: vault.propose_upgrade_delay,
		arg: 604_800n,
		args: { secs: 604_800n, caller: investorAddress },
		keys: [upgradeProposalKey, configurationReadsKey],
		refusal: 6058,
	},
	{
		name: "useApplyUpgrade",
		useHook: useApplyUpgrade,
		method: vault.apply_upgrade,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [upgradeProposalKey, configurationReadsKey],
		refusal: 6057,
	},
	{
		name: "useCancelUpgrade",
		useHook: useCancelUpgrade,
		method: vault.cancel_upgrade,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [upgradeProposalKey, configurationReadsKey],
		refusal: 6056,
	},
	{
		name: "useProposeWindDown",
		useHook: useProposeWindDown,
		method: vault.propose_wind_down,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [cycleReadsKey],
		refusal: 6046,
	},
	{
		name: "useCancelWindDown",
		useHook: useCancelWindDown,
		method: vault.cancel_wind_down_proposal,
		arg: undefined,
		args: { caller: investorAddress },
		keys: [cycleReadsKey],
		refusal: 6047,
	},
]

const confirmed = () => ({
	simulation: undefined,
	signAndSend: vi.fn().mockResolvedValue({
		getTransactionResponse: { status: "SUCCESS" },
		result: undefined,
	}),
})

const VERIFIER = "CVERIFIERADDRESS"
const TARGET = "GTARGETADDRESS1234"
const DESTINATION = "GDESTINATION5678"

const complianceCases: Case[] = [
	{
		name: "useAllowAddress",
		useHook: useAllowAddress,
		method: verifier.allow,
		arg: { verifier: VERIFIER, account: TARGET },
		args: { account: TARGET, allowed: true, caller: investorAddress },
		keys: [complianceReadsKey, isAllowedKey],
		refusal: 2000,
	},
	{
		name: "useDisallowAddress",
		useHook: useDisallowAddress,
		method: verifier.allow,
		arg: { verifier: VERIFIER, account: TARGET },
		args: { account: TARGET, allowed: false, caller: investorAddress },
		keys: [complianceReadsKey, isAllowedKey],
		refusal: 2001,
	},
	{
		name: "useFreezeAddress",
		useHook: useFreezeAddress,
		method: token.set_address_frozen,
		arg: TARGET,
		args: { user_address: TARGET, freeze: true, operator: investorAddress },
		keys: [complianceReadsKey],
		refusal: 2000,
	},
	{
		name: "useUnfreezeAddress",
		useHook: useUnfreezeAddress,
		method: token.set_address_frozen,
		arg: TARGET,
		args: { user_address: TARGET, freeze: false, operator: investorAddress },
		keys: [complianceReadsKey],
		refusal: 2000,
	},
	{
		name: "useFreezeShares",
		useHook: useFreezeShares,
		method: token.freeze_partial_tokens,
		arg: { account: TARGET, amount: 5n },
		args: { user_address: TARGET, amount: 5n, operator: investorAddress },
		keys: [complianceReadsKey],
		refusal: 300,
	},
	{
		name: "useUnfreezeShares",
		useHook: useUnfreezeShares,
		method: token.unfreeze_partial_tokens,
		arg: { account: TARGET, amount: 5n },
		args: { user_address: TARGET, amount: 5n, operator: investorAddress },
		keys: [complianceReadsKey],
		refusal: 303,
	},
	{
		name: "useForceTransfer",
		useHook: useForceTransfer,
		method: token.forced_transfer,
		arg: { from: TARGET, to: DESTINATION, amount: 5n },
		args: {
			from: TARGET,
			to: DESTINATION,
			amount: 5n,
			operator: investorAddress,
		},
		keys: [complianceReadsKey, ["share", "balance"]],
		refusal: 300,
	},
]

describe.each([...cases, ...governanceCases, ...complianceCases])(
	"$name",
	(testCase) => {
		const { useHook, method, arg, args, keys, refusal } = testCase

		beforeEach(() => {
			vi.clearAllMocks()
			verifierWriterMock.mockImplementation(
				(address: string) => async () =>
					address === VERIFIER ? verifier : undefined,
			)
		})

		it("signs as the connected wallet and confirms", async () => {
			const gate = deferred<void>()
			method.mockResolvedValue({
				simulation: undefined,
				signAndSend: vi.fn(
					async ({ watcher }: { watcher: { onSubmitted: () => void } }) => {
						await gate.promise
						watcher.onSubmitted()
						return {
							getTransactionResponse: { status: "SUCCESS" },
							result: undefined,
						}
					},
				),
			})
			const { result } = renderWithWallet(useHook)

			expect(result.current.submit(arg as never)).toBe(true)
			await waitFor(() =>
				expect(result.current.status).toEqual({ status: "awaiting-signature" }),
			)

			gate.resolve()
			await waitFor(() =>
				expect(result.current.status).toEqual({ status: "confirmed" }),
			)
			expect(method.mock.calls).toEqual([args === undefined ? [] : [args]])
		})

		it("refuses before asking for a signature and refreshes the state it read", async () => {
			const signAndSend = vi.fn()
			method.mockResolvedValue({
				simulation: { error: `HostError: Error(Contract, #${refusal})` },
				signAndSend,
			})
			const { result, queryClient } = renderWithWallet(useHook)
			const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

			await act(() => result.current.submit(arg as never))

			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "contract-error", code: refusal },
			})
			expect(signAndSend).not.toHaveBeenCalled()
			for (const queryKey of keys)
				expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		})

		it("tells a declined signature apart from a failure", async () => {
			method.mockResolvedValue({
				simulation: undefined,
				signAndSend: vi
					.fn()
					.mockRejectedValue(
						new AssembledTransaction.Errors.UserRejected(
							"User declined access",
						),
					),
			})
			const { result } = renderWithWallet(useHook)

			await act(() => result.current.submit(arg as never))

			expect(result.current.status).toEqual({
				status: "failed",
				failure: { kind: "declined" },
			})
		})

		it("refreshes the state it changed once confirmed", async () => {
			method.mockResolvedValue(confirmed())
			const { result, queryClient } = renderWithWallet(useHook)
			const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")

			await act(() => result.current.submit(arg as never))

			for (const queryKey of keys)
				expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
		})
	},
)

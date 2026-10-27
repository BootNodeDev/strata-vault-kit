import { Buffer } from "buffer"
import { AssembledTransaction } from "@stellar/stellar-sdk/contract"
import type * as AppLib from "@stellar-scaffold/app-lib"
import { OPERATOR_TIMEOUT_SECONDS } from "@stellar-scaffold/app-lib"
import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { governanceReadsKey } from "./pendingAdmins"
import { deferred, investorAddress, renderWithWallet } from "./testSupport"
import { adminAuthorityKey, type Grant } from "./useAdminAuthority"
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
	useProposeCompliance,
	useProposeCustodian,
	useProposeIdentityVerifier,
	useProposeNotice,
	useProposeWindDownDelay,
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
	usePauseNav,
	useSetNavPaused,
	useUnpauseToken,
	useUnpauseVault,
} from "./useEmergencyTransactions"
import { pendingChangesKey } from "./useGovernanceState"
import {
	useAcceptOracleAdmin,
	useAcceptTokenAdmin,
	useAcceptVaultAdmin,
	useApplyChange,
	useApplyTokenChange,
	useCancelOracleHandover,
	useCancelTokenHandover,
	useCancelChange,
	useCancelTokenChange,
	useCancelVaultHandover,
	useCancelWindDown,
	useGrantOracleRole,
	useGrantTokenRole,
	useGrantVaultRole,
	useHandOverOracleAdmin,
	useHandOverTokenAdmin,
	useHandOverVaultAdmin,
	useProposeAdmin,
	useProposeCodeUpgrade,
	useProposeGrantRole,
	useProposeRevokeRole,
	useProposeTokenAdmin,
	useProposeTokenGrantRole,
	useProposeTokenRevokeRole,
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

const {
	vault,
	token,
	oracle,
	verifier,
	verifierWriterMock,
	asyncVaultWriterMock,
	submitSignedMock,
	decodePendingMock,
} = vi.hoisted(() => ({
	asyncVaultWriterMock: vi.fn(),
	submitSignedMock: vi.fn(),
	decodePendingMock: vi.fn(),
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
		propose_change: vi.fn(),
		apply_change: vi.fn(),
		cancel_change: vi.fn(),
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
		propose_change: vi.fn(),
		apply_change: vi.fn(),
		cancel_change: vi.fn(),
	},
	verifier: { allow: vi.fn() },
	verifierWriterMock: vi.fn(),
	oracle: {
		pause_nav: vi.fn(),
		set_nav_paused: vi.fn(),
		clear_latest: vi.fn(),
		set_config: vi.fn(),
		grant_role: vi.fn(),
		revoke_role: vi.fn(),
		transfer_admin_role: vi.fn(),
		accept_admin_transfer: vi.fn(),
	},
}))

vi.mock("@stellar-scaffold/app-lib", async (importOriginal) => ({
	...(await importOriginal<typeof AppLib>()),
	submitSigned: submitSignedMock,
	decodePending: decodePendingMock,
}))

vi.mock("../config/clients", () => ({
	asyncVaultWriter: asyncVaultWriterMock,
	shareTokenWriter: async () => token,
	navOracleWriter: async () => oracle,
	identityVerifierWriter: verifierWriterMock,
}))

const CONTRACT = "CCONTRACTADDRESS1234567890"
const ORACLE_CONFIG = {
	freshness_duration: 86_400n,
	cooldown_secs: 3_600n,
	max_up_bps: 1_000,
	max_down_bps: 500,
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
		name: "usePauseNav",
		useHook: usePauseNav,
		method: oracle.pause_nav,
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
		keys: oracleWriteKeys,
		refusal: 3008,
	},
	{
		name: "useSetNavPaused",
		useHook: useSetNavPaused,
		method: oracle.set_nav_paused,
		arg: false,
		args: { paused: false },
		keys: oracleWriteKeys,
		refusal: 2000,
	},
	{
		name: "useSetDepositCap",
		useHook: useSetDepositCap,
		method: vault.set_deposit_cap,
		arg: null,
		args: { cap: null },
		keys: [cycleReadsKey],
		refusal: 6007,
	},
	{
		name: "useSetCustodian",
		useHook: useSetCustodian,
		method: vault.set_custodian,
		arg: CONTRACT,
		args: { custodian: CONTRACT },
		keys: [vaultAuthoritiesKey],
		refusal: 2000,
	},
	{
		name: "useSetNotice",
		useHook: useSetNotice,
		method: vault.set_notice,
		arg: 86_400n,
		args: { secs: 86_400n },
		keys: [cycleReadsKey],
		refusal: 6061,
	},
	{
		name: "useSetWindDownDelay",
		useHook: useSetWindDownDelay,
		method: vault.set_wind_down_delay,
		arg: 86_400n,
		args: { secs: 86_400n },
		keys: [cycleReadsKey],
		refusal: 6053,
	},
	{
		name: "useProposeCustodian",
		useHook: useProposeCustodian,
		method: vault.propose_change,
		arg: CONTRACT,
		args: { change: { tag: "Custodian", values: [CONTRACT] } },
		keys: [pendingChangesKey("vault"), vaultAuthoritiesKey],
		refusal: 6075,
	},
	{
		name: "useProposeNotice",
		useHook: useProposeNotice,
		method: vault.propose_change,
		arg: 43_200n,
		args: { change: { tag: "Notice", values: [43_200n] } },
		keys: [pendingChangesKey("vault"), cycleReadsKey],
		refusal: 6061,
	},
	{
		name: "useProposeWindDownDelay",
		useHook: useProposeWindDownDelay,
		method: vault.propose_change,
		arg: 691_200n,
		args: { change: { tag: "WindDownDelay", values: [691_200n] } },
		keys: [pendingChangesKey("vault"), cycleReadsKey],
		refusal: 6069,
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
	{
		name: "useProposeCompliance",
		useHook: useProposeCompliance,
		method: token.propose_change,
		arg: CONTRACT,
		args: { change: { tag: "Compliance", values: [CONTRACT] } },
		keys: [pendingChangesKey("token"), configurationReadsKey],
		refusal: 7004,
	},
	{
		name: "useProposeIdentityVerifier",
		useHook: useProposeIdentityVerifier,
		method: token.propose_change,
		arg: CONTRACT,
		args: { change: { tag: "IdentityVerifier", values: [CONTRACT] } },
		keys: [pendingChangesKey("token"), configurationReadsKey],
		refusal: 7003,
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
		method: vault.propose_change,
		arg: WASM_HASH,
		args: { change: { tag: "Upgrade", values: [Buffer.alloc(32, 0xab)] } },
		keys: [pendingChangesKey("vault"), configurationReadsKey],
		refusal: 6055,
	},
	{
		name: "useProposeUpgradeDelay",
		useHook: useProposeUpgradeDelay,
		method: vault.propose_change,
		arg: 604_800n,
		args: { change: { tag: "UpgradeDelay", values: [604_800n] } },
		keys: [pendingChangesKey("vault"), configurationReadsKey],
		refusal: 6058,
	},
	{
		name: "useProposeGrantRole",
		useHook: useProposeGrantRole,
		method: vault.propose_change,
		arg: ROLE_CHANGE,
		args: { change: { tag: "GrantRole", values: ["guardian", CONTRACT] } },
		keys: [pendingChangesKey("vault")],
		refusal: 6063,
	},
	{
		name: "useProposeRevokeRole",
		useHook: useProposeRevokeRole,
		method: vault.propose_change,
		arg: ROLE_CHANGE,
		args: { change: { tag: "RevokeRole", values: ["guardian", CONTRACT] } },
		keys: [pendingChangesKey("vault")],
		refusal: 6064,
	},
	{
		name: "useProposeAdmin",
		useHook: useProposeAdmin,
		method: vault.propose_change,
		arg: CONTRACT,
		args: { change: { tag: "Admin", values: [CONTRACT] } },
		keys: [pendingChangesKey("vault")],
		refusal: 6046,
	},
	{
		name: "useApplyChange",
		useHook: useApplyChange,
		method: vault.apply_change,
		arg: 3,
		args: { id: 3 },
		keys: [
			pendingChangesKey("vault"),
			configurationReadsKey,
			cycleReadsKey,
			governanceReadsKey,
			adminAuthorityKey,
			vaultAuthoritiesKey,
		],
		refusal: 6057,
	},
	{
		name: "useCancelChange",
		useHook: useCancelChange,
		method: vault.cancel_change,
		arg: 3,
		args: { id: 3 },
		keys: [pendingChangesKey("vault")],
		refusal: 6056,
	},
	{
		name: "useProposeTokenGrantRole",
		useHook: useProposeTokenGrantRole,
		method: token.propose_change,
		arg: ROLE_CHANGE,
		args: { change: { tag: "GrantRole", values: ["guardian", CONTRACT] } },
		keys: [pendingChangesKey("token")],
		refusal: 7003,
	},
	{
		name: "useProposeTokenRevokeRole",
		useHook: useProposeTokenRevokeRole,
		method: token.propose_change,
		arg: ROLE_CHANGE,
		args: { change: { tag: "RevokeRole", values: ["guardian", CONTRACT] } },
		keys: [pendingChangesKey("token")],
		refusal: 7008,
	},
	{
		name: "useProposeTokenAdmin",
		useHook: useProposeTokenAdmin,
		method: token.propose_change,
		arg: CONTRACT,
		args: { change: { tag: "Admin", values: [CONTRACT] } },
		keys: [pendingChangesKey("token")],
		refusal: 7004,
	},
	{
		name: "useApplyTokenChange",
		useHook: useApplyTokenChange,
		method: token.apply_change,
		arg: 3,
		args: { id: 3 },
		keys: [
			pendingChangesKey("token"),
			configurationReadsKey,
			governanceReadsKey,
			adminAuthorityKey,
			isAllowedKey,
		],
		refusal: 7009,
	},
	{
		name: "useCancelTokenChange",
		useHook: useCancelTokenChange,
		method: token.cancel_change,
		arg: 3,
		args: { id: 3 },
		keys: [pendingChangesKey("token")],
		refusal: 7001,
	},
	{
		name: "useProposeWindDown",
		useHook: useProposeWindDown,
		method: vault.propose_wind_down,
		arg: undefined,
		keys: [cycleReadsKey],
		refusal: 6046,
	},
	{
		name: "useCancelWindDown",
		useHook: useCancelWindDown,
		method: vault.cancel_wind_down_proposal,
		arg: undefined,
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
		args: { account: TARGET, allowed: true },
		keys: [complianceReadsKey, isAllowedKey],
		refusal: 2000,
	},
	{
		name: "useDisallowAddress",
		useHook: useDisallowAddress,
		method: verifier.allow,
		arg: { verifier: VERIFIER, account: TARGET },
		args: { account: TARGET, allowed: false },
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
			asyncVaultWriterMock.mockResolvedValue(vault)
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

describe("usePauseVault with a grant", () => {
	const AUTHORITY = "GAUTHORITYACCOUNT0987654321"
	const HASH = "c".repeat(64)
	const grantWith = (standing: Grant["standing"]): Grant => ({
		role: "vault guardian",
		authority: AUTHORITY,
		standing,
	})
	const signable = () => {
		const signed = {
			toEnvelope: () => ({ toXDR: () => "SIGNEDXDR" }),
		}
		const tx = {
			simulation: undefined,
			result: undefined,
			signed: undefined as typeof signed | undefined,
			sign: vi.fn(async () => {
				tx.signed = signed
			}),
			signAndSend: vi.fn(),
		}
		return { tx, signed }
	}

	beforeEach(() => {
		vi.clearAllMocks()
		asyncVaultWriterMock.mockResolvedValue(vault)
	})

	it("builds as the authority with the operator timeout and submits the signed transaction when the wallet signs alone", async () => {
		const { tx, signed } = signable()
		vault.pause.mockResolvedValue(tx)
		submitSignedMock.mockResolvedValue({ status: "success", hash: HASH })
		const { result } = renderWithWallet(usePauseVault)

		await act(() => result.current.submit(undefined, grantWith("signs-alone")))

		expect(asyncVaultWriterMock).toHaveBeenCalledWith({
			publicKey: AUTHORITY,
			signTransaction: expect.any(Function),
			timeoutInSeconds: OPERATOR_TIMEOUT_SECONDS,
		})
		expect(vault.pause).toHaveBeenCalledWith({ caller: AUTHORITY })
		expect(tx.sign).toHaveBeenCalledTimes(1)
		expect(submitSignedMock).toHaveBeenCalledWith(signed)
		expect(tx.signAndSend).not.toHaveBeenCalled()
		expect(result.current.status).toEqual({ status: "confirmed", hash: HASH })
	})

	it.each<[Exclude<Grant["standing"], "signs-alone">]>([
		[{ needs: 2 }],
		[{ weight: 2, threshold: 3 }],
	])(
		"shares the signed transaction instead of submitting when %j",
		async (standing) => {
			const { tx } = signable()
			const expiresAt = new Date("2026-10-22T00:00:00Z")
			vault.pause.mockResolvedValue(tx)
			decodePendingMock.mockReturnValue({ expiresAt })
			const { result } = renderWithWallet(usePauseVault)

			await act(() => result.current.submit(undefined, grantWith(standing)))

			expect(decodePendingMock).toHaveBeenCalledWith("SIGNEDXDR")
			expect(submitSignedMock).not.toHaveBeenCalled()
			expect(result.current.status).toEqual({
				status: "shared",
				xdr: "SIGNEDXDR",
				standing,
				expiresAt,
			})
		},
	)

	it("names the network's reason when the submission fails", async () => {
		const { tx } = signable()
		vault.pause.mockResolvedValue(tx)
		submitSignedMock.mockResolvedValue({
			status: "failed",
			reason: "bad-auth",
			hash: HASH,
		})
		const { result } = renderWithWallet(usePauseVault)

		await act(() => result.current.submit(undefined, grantWith("signs-alone")))

		expect(result.current.status).toEqual({
			status: "failed",
			failure: { kind: "network", reason: "bad-auth" },
			hash: HASH,
		})
	})

	it("keeps signing and sending as the wallet when no grant is given", async () => {
		const { tx } = signable()
		tx.signAndSend.mockResolvedValue({
			getTransactionResponse: { status: "SUCCESS" },
			result: undefined,
		})
		vault.pause.mockResolvedValue(tx)
		const { result } = renderWithWallet(usePauseVault)

		await act(() => result.current.submit(undefined))

		expect(asyncVaultWriterMock).toHaveBeenCalledWith({
			publicKey: investorAddress,
			signTransaction: expect.any(Function),
		})
		expect(tx.sign).not.toHaveBeenCalled()
		expect(submitSignedMock).not.toHaveBeenCalled()
		expect(result.current.status).toEqual({ status: "confirmed" })
	})
})

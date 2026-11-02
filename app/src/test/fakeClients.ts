import { type AssembledTransaction } from "@stellar/stellar-sdk/contract"
import {
	type AssetApi,
	type AsyncVaultApi,
	type IdentityVerifierApi,
	type NavOracleApi,
	type ShareTokenApi,
} from "@stellar-scaffold/app-lib"
import { vi, type Mock } from "vitest"
import { type WriterSigner as Signer } from "../config/clients"

type CallName<Client> = {
	[Name in keyof Client]: Client[Name] extends (
		...args: never[]
	) => Promise<AssembledTransaction<unknown>>
		? Name
		: never
}[keyof Client]

// What a faked call resolves to. Only `result` takes its type from the
// contract; the other members are SDK internals that tests stand in for loosely.
export type FakeTransaction<Result> = { result?: Result } & {
	[Member in Exclude<keyof AssembledTransaction<Result>, "result">]?: unknown
}

type FakeCall<Call> = Call extends (
	...args: infer Args
) => Promise<AssembledTransaction<infer Result>>
	? Mock<(...args: Args) => Promise<FakeTransaction<Result>>>
	: never

export type FakeClient<
	Client,
	Name extends CallName<Client> = CallName<Client>,
> = { [N in Name]: FakeCall<Client[N]> }

type AnyFake<Client> = Partial<FakeClient<Client>>

const fakes: {
	vault: AnyFake<AsyncVaultApi>
	token: AnyFake<ShareTokenApi>
	oracle: AnyFake<NavOracleApi>
	asset: AnyFake<AssetApi>
	verifier: AnyFake<IdentityVerifierApi> | undefined
} = { vault: {}, token: {}, oracle: {}, asset: {}, verifier: undefined }

const fakeOf =
	<Client>() =>
	<Name extends CallName<Client>>(...names: Name[]): FakeClient<Client, Name> =>
		Object.fromEntries(names.map((name) => [name, vi.fn()])) as FakeClient<
			Client,
			Name
		>

// Each fake becomes the client `config/clients` hands out for its contract,
// to readers and writers alike, until the next fake of that contract.
export const fakeAsyncVault = <Name extends CallName<AsyncVaultApi>>(
	...names: Name[]
) => (fakes.vault = fakeOf<AsyncVaultApi>()(...names))

export const fakeShareToken = <Name extends CallName<ShareTokenApi>>(
	...names: Name[]
) => (fakes.token = fakeOf<ShareTokenApi>()(...names))

export const fakeNavOracle = <Name extends CallName<NavOracleApi>>(
	...names: Name[]
) => (fakes.oracle = fakeOf<NavOracleApi>()(...names))

export const fakeAsset = <Name extends CallName<AssetApi>>(...names: Name[]) =>
	(fakes.asset = fakeOf<AssetApi>()(...names))

export const fakeIdentityVerifier = <
	Name extends CallName<IdentityVerifierApi>,
>(
	...names: Name[]
) => (fakes.verifier = fakeOf<IdentityVerifierApi>()(...names))

export const asyncVault = vi.fn(async () => fakes.vault)
export const asyncVaultWriter = vi.fn(async (_signer: Signer) => fakes.vault)
export const shareToken = vi.fn(async () => fakes.token)
export const shareTokenWriter = vi.fn(async (_signer: Signer) => fakes.token)
export const navOracle = vi.fn(async () => fakes.oracle)
export const navOracleWriter = vi.fn(async (_signer: Signer) => fakes.oracle)
export const asset = vi.fn(async () => fakes.asset)
export const identityVerifierAt = vi.fn(
	async (_address: string) => fakes.verifier,
)
export const identityVerifierWriter = vi.fn(
	(_address: string) => async (_signer: Signer) => fakes.verifier,
)

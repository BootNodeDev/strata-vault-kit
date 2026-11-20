import { type Address } from "@stellar/stellar-sdk"
import { describe, expect, expectTypeOf, it, vi } from "vitest"
import * as clients from "../config/clients"
import * as fakeClients from "./fakeClients"
import {
	asset,
	asyncVault,
	asyncVaultWriter,
	fakeAsset,
	fakeAsyncVault,
	fakeIdentityRegistry,
	fakeIdentityVerifier,
	fakeNavOracle,
	fakeShareToken,
	identityRegistryAt,
	identityRegistryWriter,
	identityVerifierAt,
	identityVerifierWriter,
	navOracle,
	navOracleWriter,
	shareToken,
	shareTokenWriter,
} from "./fakeClients"

vi.mock("../config/clients", () => import("./fakeClients"))

const signer = { publicKey: "GSIGNER", signTransaction: vi.fn() }

describe("fake clients", () => {
	it("fakes every client config/clients hands out", async () => {
		const real = await vi.importActual<typeof clients>("../config/clients")

		for (const name of Object.keys(real)) {
			expect(fakeClients).toHaveProperty(name)
		}
	})

	it("is the module a mocked config/clients serves", async () => {
		const vault = fakeAsyncVault("paused")

		expect(clients.asyncVault).toBe(asyncVault)
		expect(await clients.asyncVault()).toBe(vault)
	})

	it("gives each named call its own mock and nothing else", () => {
		const vault = fakeAsyncVault("current_epoch", "cancel_deposit")

		expect(Object.keys(vault)).toEqual(["current_epoch", "cancel_deposit"])
		expect(vi.isMockFunction(vault.current_epoch)).toBe(true)
		expect(vault.current_epoch).not.toBe(vault.cancel_deposit)
	})

	it("hands each contract's fake to its reader and writer", async () => {
		const vault = fakeAsyncVault("paused")
		const token = fakeShareToken("paused")
		const oracle = fakeNavOracle("state")
		const usdc = fakeAsset("balance")
		const verifier = fakeIdentityVerifier("identity_registry")
		const registry = fakeIdentityRegistry("compliance")

		expect(await asyncVault()).toBe(vault)
		expect(await asyncVaultWriter(signer)).toBe(vault)
		expect(await shareToken()).toBe(token)
		expect(await shareTokenWriter(signer)).toBe(token)
		expect(await navOracle()).toBe(oracle)
		expect(await navOracleWriter(signer)).toBe(oracle)
		expect(await asset()).toBe(usdc)
		expect(await identityVerifierAt("CVERIFIER")).toBe(verifier)
		expect(await identityVerifierWriter("CVERIFIER")(signer)).toBe(verifier)
		expect(await identityRegistryAt("CREGISTRY")).toBe(registry)
		expect(await identityRegistryWriter("CREGISTRY")(signer)).toBe(registry)
	})

	it("replaces a contract's fake with the next one", async () => {
		const first = fakeAsyncVault("paused")
		const next = fakeAsyncVault("current_epoch")
		fakeIdentityRegistry("compliance")
		const registry = fakeIdentityRegistry("remove_identity")

		expect(await asyncVault()).toBe(next)
		expect(await asyncVault()).not.toBe(first)
		expect(await asyncVaultWriter(signer)).toBe(next)
		expect(await identityRegistryAt("CREGISTRY")).toBe(registry)
		expect(await identityRegistryWriter("CREGISTRY")(signer)).toBe(registry)
	})

	it("keeps handing out the fakes after the mocks are reset", async () => {
		const vault = fakeAsyncVault("paused")

		vi.resetAllMocks()

		expect(await asyncVault()).toBe(vault)
		expect(await asyncVaultWriter(signer)).toBe(vault)
	})

	it("types each call by the generated client", () => {
		const vault = fakeAsyncVault("current_epoch", "cancel_deposit")
		const token = fakeShareToken("identity_verifier")

		vault.current_epoch.mockResolvedValue({ result: 3n })
		token.identity_verifier.mockResolvedValue({ result: "CVERIFIER" })
		vault.cancel_deposit.mockResolvedValue({ signAndSend: vi.fn() })
		fakeNavOracle("get_admin").get_admin.mockResolvedValue({ result: null })
		expectTypeOf(vault.cancel_deposit).parameter(0).toEqualTypeOf<{
			holder: string | Address
			epoch_id: bigint
		}>()

		// @ts-expect-error the vault has no such call
		fakeAsyncVault("no_such_call")
		// @ts-expect-error a read carries its result
		vault.current_epoch.mockResolvedValue({})
		// @ts-expect-error current_epoch returns a bigint
		vault.current_epoch.mockResolvedValue({ result: "3" })
		// @ts-expect-error current_epoch never returns undefined
		vault.current_epoch.mockResolvedValue({ result: undefined })
		// @ts-expect-error not a member of an assembled transaction
		vault.current_epoch.mockResolvedValue({ results: 3n })
		// @ts-expect-error epoch_id is a bigint
		void vault.cancel_deposit({ holder: "GHOLDER", epoch_id: 3 })
		// @ts-expect-error the call was not declared
		void vault.paused
	})
})

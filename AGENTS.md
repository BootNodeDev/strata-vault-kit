# AGENTS.md

Guidance for agents and developers working in this repo. This file is the source
of truth for how to build, run and not break things. `CLAUDE.md` points here.

It deliberately does **not** restate the design or the dependency versions. The
design is in
[`docs/strata-product-and-architecture.md`](./docs/strata-product-and-architecture.md);
versions are pinned in `Cargo.toml` and `rust-toolchain.toml`. A second copy of
either would go stale. Work items live in
[milestone M1](https://github.com/BootNodeDev/strata-vault-kit/milestone/2).

## What this is

A white-label RWA vault kit on Stellar/Soroban. Shares are a claim on an
off-chain asset whose value is attested on chain, so no price exists at the
moment an investor acts. Entry and exit are therefore requests: what goes in is
escrowed, the next accepted attestation prices it, and the investor claims the
result. Three states per side, none skipped: **pending, priced, claimed**.

What the contracts enforce:

1. **Only allowlisted addresses enter.** The post-KYC allowlist is checked
   when a subscription is requested, again when its shares are minted, and on
   every share transfer.
2. **A covered claim always pays.** Once priced and covered, a cash claim cannot
   be blocked by a pause, a stale valuation, or the investor losing their
   allowlist place. Priced claims are never re-priced and never identity-gated;
   a delisted, non-frozen investor leaves through the exit-only cash path,
   including a deposit that was priced before the delisting.
3. **Cancellation is atomic and single-step**, open only while the vault cannot
   price the request: the attestation that prices it closes cancellation, and
   cancellation reopens if that report expires, the NAV is paused or the vault
   is paused. There is no instant exit.

Five authorities, each a native Stellar multisig: governance, compliance,
attestation, treasury, guardian. Testnet only. Not audited.

## Reference base

[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp)
is our own working testnet demo, but it is **synchronous**: deposit and withdraw
are priced at call time. It does not model the request lifecycle and its flow
does not carry over. Read it for Soroban and OZ mechanics only.

## Build & run

- **Contracts:** `stellar contract build` — **not** `cargo build`. The OZ crates
  enable an experimental `soroban-sdk` feature (`spec_shaking_v2`) that only
  works through the CLI wrapper. The devshell pins the Stellar CLI it expects.
- **Tests:** `cargo test` from the repo root runs every workspace member against
  the in-memory `Env`. There is no unit-test runner for `app/` or `app-lib/`;
  `e2e/` runs Playwright separately. CI runs `cargo test --locked` on every pull
  request.
- **Toolchain:** `nix develop` provides it, or rustup honours
  `rust-toolchain.toml`.

## Gotchas

Carried over from the reference base, where each one cost real debugging. They
apply as the corresponding code lands here.

- Build with `stellar contract build`, not `cargo build` (see above).
- A SEP-56 vault is **not** the base here: its interface assumes the price
  exists at call time, which a request lifecycle cannot express.
- `ed25519-dalek` is transitive and unpinned by any manifest. A newer major
  breaks the test build; hold it back in the lockfile if compilation fails
  there.
- The deposit asset is a **classic asset** → an account needs a trustline to
  hold it. The share token is a **Soroban contract token** → no trustline.
  Deposit is a single transaction with nested authorization; there is no
  separate `approve`. When the deposit asset is USDC, Circle's faucet (pick
  Stellar) issues test units once the trustline exists.
- Two network configs must agree: `environments.toml` is the network the
  CLI/scaffold **deploys** to, `app/.env` (`PUBLIC_STELLAR_*`) is the network
  the **frontend** reads at runtime. The scaffold default is local, so both need
  setting or the UI talks to the wrong chain.
- Generated contract clients ship their `src/` but not their `dist/`. A fresh
  clone builds the client before the app, or `tsc` cannot resolve the module.
- `app-lib/clients/index.ts` is auto-generated and rewritten on every build or
  redeploy. Do not hand-edit it; customize by importing the client under `app/`.
- `app/` never imports the generated barrel. `app/`'s `prebuild` runs
  `scripts/generate-clients.mjs`, which reads the contract ids and RPC URL of
  `ADDRESSES_ENV` (default `staging`) from `environments.toml` and writes
  `app-lib/clients/<contract>/` from each contract's on-chain spec, with Node
  alone. `development` declares no ids: there the script resolves each
  `[development.contracts.<name>]` block plus an alias named `asset` through
  `stellar contract alias show`, so CI builds the app against the contracts
  the branch just deployed. The scaffold registers the block aliases when it
  deploys; the asset is a Stellar Asset Contract a developer registers once with
  `stellar contract asset deploy --asset native --alias asset --source me`
  against the local network. Those generated types are the only contract types; `app-lib/contracts.ts`
  re-exports them and builds each runtime client with `new Client(...)` from its
  generated `src/index`, whose embedded spec means no page fetches a contract's
  instance or Wasm. Vite dedupes `@stellar/stellar-sdk` so a client's nested copy
  never reaches the bundle, and vitest aliases the generated modules to
  `vitest.clients.ts`, since tests run without them.
  A fresh clone builds `app` with no cargo, no stellar CLI and no local network,
  but needs RPC access to the selected network at build time. A local scaffold
  build writes the same directory from the WASM.
- When a tool must drive `cargo` directly rather than the CLI, set
  `SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1`. The build script fails
  without it and its error names neither the variable nor this way out, so
  coverage runs and size checks look impossible until you read the SDK source.
- Change a contract's `__constructor` and you must change its `constructor_args`
  in `environments.toml` in the same commit. Otherwise the scaffold build still
  exits 0 and CI fails minutes later on a client count, naming neither the
  contract nor the argument. This has broken two pull requests.
- An `after_deploy` line is appended to
  `stellar contract invoke --id <this contract> --`, so it can only call the
  contract whose block it sits in. Wiring that crosses contracts, such as
  granting the vault a role on the share token, needs a script instead.
- Stellar keeps contract events for days, not forever. Anything that needs
  history stores it on-chain or has an off-chain collector writing it down as it
  happens; it cannot be rebuilt by replaying the past.

## Deployed addresses

Not recorded here on purpose. The reference base kept them in this file and they
drifted: its `AGENTS.md` and its generated client pointed at two different vault
contracts. The addresses emitted by the deploy script are authoritative.

## Code conventions

- **Crate names.** Shared crates in `crates/` start with `strata-`
  (`strata-timelock`, `strata-storage`, `strata-bindings`), so a path such as
  `strata_timelock::DAY_DURATION` reads as the kit's own code.
- **Addresses in entrypoints.** In an entrypoint the kit defines, `caller` is
  the account that must sign the call, and `holder` is the account whose
  position, request or balance the call is about. When one account is both, the
  entrypoint takes `holder` and that account signs. The two ends of a share
  transfer are `from` and `to`, and other addresses are named for what they
  are (`custodian`, `vault`, the allowlisted `account`). OpenZeppelin trait
  methods keep their own names (`operator`, `user_address`).
- **Named errors.** Contract code fails with a named error variant, never with
  `unwrap`, `expect` or a bare `panic!`. Tests may unwrap. Each contract
  declares its error enum through `strata_bindings::error_enum!`, which fails
  the build if a code leaves the contract's block (`docs/kit-spec.md`, section
  7).
- **No boolean switches.** A new entrypoint does one thing. Two behaviours get
  two functions, like `freeze_partial_tokens` and `unfreeze_partial_tokens`,
  not one function that takes a `bool`.
- **Guards.** Each precondition is a `pub(crate) fn` in the contract's
  `guards.rs`. Its name is the condition it checks (`positive_amount`,
  `not_winding_down`), and it panics with a named error when the condition
  fails. An entrypoint calls its guards first and then does its work, so its
  preconditions are the first lines a reader sees.
- **Doc comments.** Every public entrypoint has one, in OpenZeppelin's style: a
  one-line summary, then `# Arguments` with units (asset base units, share base
  units, WAD prices, seconds or ledgers), `# Errors`, `# Events` and
  `# Authorization`. Every error variant's doc says when it happens. Keep them
  short: they are stored in the Wasm as part of the contract spec, which keeps
  1,024 bytes of each doc and drops the rest without a warning.
  `every_contract_doc_fits_the_spec` (`crates/strata-bindings/tests/spec_docs.rs`)
  fails when one is longer.
- **Design notes.** Each contract's `lib.rs` opens with a `//! # Design`
  section: five to ten bullets, each a choice and its trade-off, in plain words
  and with no issue numbers or decision ids.
- **Exact pins.** Every crates.io dependency, dev-dependencies included, is
  pinned with `=` to the version in `Cargo.lock`.

## Conventions

- Conventional Commits, imperative, subject ≤ 50 chars. **No AI attribution.**
- Issue-first: every PR closes an issue (`Closes #N`). Branches are
  `feat/<issue>-<desc>`, `fix/...`, `chore/...`.
- Issue bodies follow the templates in `.github/ISSUE_TEMPLATE/`, 200 words of
  prose hard cap. Titles are natural language with no prefix.
- Dependencies are never upgraded mid-milestone; each migration is its own
  issue in the following one.
- Estimates live in the `Estimate` field of the
  [project board](https://github.com/orgs/BootNodeDev/projects/29), not in issue
  bodies.
- Everything written to GitHub, the repo or a commit is in English.
- Local agent tooling (`.claude/`, `.mcp.json`, `.ignore`) is gitignored: it
  wires an agent to binaries a teammate may not have installed.

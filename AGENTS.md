# AGENTS.md

Guidance for agents and developers working in this repo. This file is the source
of truth for how to build, run and not break things. `CLAUDE.md` points here.

It deliberately does **not** restate versions, decisions or known upstream
issues — those live in [`docs/roadmap-m1.md`](./docs/roadmap-m1.md), and a
second copy would go stale. What the product _is_ — and is not — is specified in
[`docs/m1-brief.md`](./docs/m1-brief.md). Work items live in
[milestone M1](https://github.com/BootNodeDev/open-rwa-vault/milestone/1).

## What this is

A white-label tokenized vault on Stellar/Soroban, built on the OpenZeppelin
Soroban vault. An approved investor deposits USDC and receives `bvUSDC` shares;
they redeem and get USDC back.

Two invariants the contract enforces:

1. **Entry is gated** by a post-KYC allowlist — the `deposit`/`mint` receiver,
   and both sides of `transfer`/`transfer_from`.
2. **Exit is never gated and never pausable.** A de-listed holder can always
   leave. `withdraw`/`redeem` carry no allowlist check by design.

Milestone 1 has no yield: shares stay 1:1. Testnet only. Not audited.

## State of the repo

Bootstrap only: documentation, issue templates and the toolchain pin. The Rust
workspace arrives with the first contract crate, and the interface after that.
The sections below describe how the project is built as each piece lands.

## Reference base

[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp)
is our own working testnet demo. Its 188-line contract proves the design. Read
it while building; do not port it wholesale. Its frontend is not carried over —
M1 builds a new one designed around the role model.

## Build & run

- **Contracts:** `stellar contract build` — **not** `cargo build`. The OZ crates
  enable an experimental `soroban-sdk` feature (`spec_shaking_v2`) that only
  works through the CLI wrapper (Stellar CLI ≥ 25.2).
- **Tests:** `cargo test -p vault` (unit tests run against the in-memory `Env`).
- **Toolchain:** pinned in `rust-toolchain.toml`. rustup installs it on first
  build.

## Gotchas

Carried over from the reference base, where each one cost real debugging. They
apply as the corresponding code lands here.

- Build with `stellar contract build`, not `cargo build` (see above).
- OZ vault wiring: `#[contractimpl(contracttrait)]` on **both** `FungibleToken`
  and `FungibleVault`; `type ContractType = Vault` goes **only** on
  `FungibleToken`; import `soroban_sdk::MuxedAddress` (the contracttrait macro
  references it).
- Do **not** call `operator.require_auth()` inside overridden vault methods —
  `Vault::*` already authorizes, and a second call fails with
  `Error(Auth, ExistingValue)`.
- `ed25519-dalek` v3 breaks the test build; pin to `2.2.0` if it resolves
  higher.
- `motion` must be v12+ (`motion/react`); a bare `npm i motion` pulls v10
  (Motion One), which has no React entry.
- USDC is a **classic asset** → an account needs a trustline to hold it.
  `bvUSDC` is a **Soroban contract token** → no trustline. Deposit is a single
  transaction with nested authorization; there is no separate `approve`. Get
  test USDC from Circle's faucet (pick Stellar) after establishing the
  trustline.
- Two network configs must agree: `environments.toml` is the network the
  CLI/scaffold **deploys** to, `app/.env` (`PUBLIC_STELLAR_*`) is the network
  the **frontend** reads at runtime. The scaffold default is local, so both need
  setting or the UI talks to the wrong chain.
- Generated contract clients ship their `src/` but not their `dist/`. A fresh
  clone builds the client before the app, or `tsc` cannot resolve the module.
- `app-lib/clients/index.ts` is auto-generated and rewritten on every build or
  redeploy. Do not hand-edit it; customize by importing the client under `app/`.

## Deployed addresses

Not recorded here on purpose. The reference base kept them in this file and they
drifted: its `AGENTS.md` and its generated client pointed at two different vault
contracts. The addresses emitted by the deploy script (#15) are authoritative.

## Conventions

- Conventional Commits, imperative, subject ≤ 50 chars. **No AI attribution.**
- Issue-first: every PR closes an issue (`Closes #N`). Branches are
  `feat/<issue>-<desc>`, `fix/...`, `chore/...`.
- Issue bodies follow the templates in `.github/ISSUE_TEMPLATE/`, 200 words of
  prose hard cap. Titles are natural language with no prefix.
- Exact dependency pins. Dependencies are never upgraded mid-milestone; each
  migration is its own issue in the following one.
- Estimates live in the `Estimate` field of the
  [project board](https://github.com/orgs/BootNodeDev/projects/29), not in issue
  bodies.
- Everything written to GitHub, the repo or a commit is in English.
- Local agent tooling (`.claude/`, `.mcp.json`, `.ignore`) is gitignored: it
  wires an agent to binaries a teammate may not have installed.

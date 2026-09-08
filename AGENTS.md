# AGENTS.md

Guidance for agents and developers working in this repo. This file is the source
of truth for how to build, run and not break things. `CLAUDE.md` points here.

It deliberately does **not** restate the design or the dependency versions. The
design is in [`docs/architecture.md`](./docs/architecture.md); versions are
pinned in `Cargo.toml` and `rust-toolchain.toml`. A second copy of either would
go stale. Work items live in
[milestone M1](https://github.com/BootNodeDev/strata-vault-kit/milestone/1).

## What this is

A white-label RWA vault kit on Stellar/Soroban. Shares are a claim on an
off-chain asset whose value is attested on chain, so no price exists at the
moment an investor acts. Entry and exit are therefore requests: what goes in is
escrowed, the next accepted attestation prices it, and the investor claims the
result. Three states per side, none skipped: **pending, priced, claimed**.

What the contracts enforce:

1. **Entry is gated** by a post-KYC allowlist, checked on the receiver of a
   subscription and on every share transfer.
2. **A covered claim always pays.** Once priced and covered, a cash claim cannot
   be blocked by a pause, a stale valuation, or the investor losing their
   allowlist place. Priced claims are never re-priced and never identity-gated;
   a delisted, non-frozen investor leaves through the exit-only cash path.
3. **Cancellation is atomic and single-step**, open only until the attestation
   that prices the request is accepted. There is no instant exit.

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
  `e2e/` runs Playwright separately. CI does not run the Rust tests yet.
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

## Deployed addresses

Not recorded here on purpose. The reference base kept them in this file and they
drifted: its `AGENTS.md` and its generated client pointed at two different vault
contracts. The addresses emitted by the deploy script are authoritative.

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

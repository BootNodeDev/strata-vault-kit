See [AGENTS.md](./AGENTS.md) for what this repo is, how to build and run it,
network configuration, and the Stellar-specific gotchas. It is the single source
of truth for this project's conventions.

The design lives in [`docs/architecture.md`](./docs/architecture.md) — the
source of truth for what the protocol does and why. It wins on the **what**:
properties, invariants and guarantees. On the **how**, a disagreement with the
code is resolved explicitly rather than by default — a mechanism that proves
better in the code is a reason to amend the document, not a defect.

Dependency versions are pinned in `Cargo.toml` and `rust-toolchain.toml` — read
them there rather than from prose.

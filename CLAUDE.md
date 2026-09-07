See [AGENTS.md](./AGENTS.md) for what this repo is, how to build and run it,
network configuration, and the Stellar-specific gotchas. It is the single source
of truth for this project's conventions.

The design lives in [`docs/architecture.md`](./docs/architecture.md) — the
source of truth for what the protocol does and why. Where the code and that
document disagree, the document wins and the code is behind.

Dependency versions are pinned in `Cargo.toml`, `rust-toolchain.toml` and
`flake.nix` — read them there rather than from prose.

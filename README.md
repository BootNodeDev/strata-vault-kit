# strata-vault-kit

White-label tokenized vault on Stellar for assets whose value is attested
rather than traded. Shares are a claim on an off-chain asset, so no price
exists at the moment you act: entry and exit are requests. What you put in
goes into escrow, the next accepted attestation prices it, and you claim the
result.

Each operator deploys, configures and brands an independent instance.

Two rules the contracts enforce:

1. **Only approved addresses can enter** — an allowlist maintained post-KYC.
2. **A priced claim always pays** — neither a pause, a delisting nor a stale
   valuation can block an already-priced, funded cash claim.

## Documentation

[Product and architecture](./docs/strata-product-and-architecture.md) — what
the protocol does, why it is asynchronous, and how the pieces fit together.

## Status

Pre-release, testnet only. Nothing here is audited or production-ready.

## Development

Two ways to get a working toolchain.

### With Nix (recommended)

```sh
nix develop              # pinned Rust + stellar-cli + wabt/twiggy/tlaplus + prek
stellar contract build   # build the contract wasms (not `cargo build` — OZ spec-shaking)
cargo test               # run the workspace unit tests
```

With `direnv` + `nix-direnv`, `echo 'use flake' > .envrc && direnv allow` loads
the shell — and your editor's language server — automatically.

### Without Nix

```sh
rustup show                                # installs the toolchain pinned in rust-toolchain.toml
rustup target add wasm32v1-none            # Soroban's wasm target
cargo install --locked stellar-cli@27.0.0  # or: brew install stellar-cli
stellar contract build && cargo test
```

Formatting and secret-scanning run on commit via a `prek` hook — see
`.pre-commit-config.yaml` and run `prek install` once.

## Reference base

Built on our own
[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp),
a working testnet demo. This repo is the productized version of it: code moves
across deliberately, with the roles, pause and configuration the demo never had.

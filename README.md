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

- [Product and architecture](./docs/strata-product-and-architecture.md) — what
  the protocol does, why it is asynchronous, and how the pieces fit together.
- [Kit specification](./docs/kit-spec.md) — invariants, deploy-time
  parameters, and complete role matrix.

## Status

Pre-release, testnet only. Nothing here is audited or production-ready.

## Deployed addresses

Testnet only. The deploy script rewrites the table below on every testnet
deploy from `environments.toml` → `[staging.contracts]`, which is the record.

<!-- deployed-addresses:start -->
| Contract | Address |
| --- | --- |
| `async_vault` | `CCYHYTZ25MJSFWSKOUEQTYEVOLSA7QEWHSQGJSR2BT64AOBRIQTNJM4U` |
| `nav_oracle` | `CDM7GHC4GBZVVEFBP4XCMX6EIPW67ZEOSBS7X6JQWKJCT6F7KP2KU7OF` |
| `share_token` | `CDMZCOCFE6YXKZ2RG4DMPKIMDV7YHV7G3G2OD76CYNHO4YLDOL5R3ZWX` |
| `identity_verifier` | `CBFF4YFKUT4A462LQN4APHQXZPRPT4GGE2VTHBRIK4YS4CTRFGSYQZNY` |
| `compliance` | `CBLVQHCKL3GNB6HZSDAJMLYHZASJRNNLJ57FQ3HRRSZ4XITZBBFU2MF2` |
| `asset` | `CDOC5UPUPG7UMZBO35JONIGPUDB6PUVR4HBPAMJ4OG2QJEGZO42KDWNG` |
<!-- deployed-addresses:end -->

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

### Integration & On-Chain Tests

From a fresh clone to a vault set deployed on a local network. Run these inside
`nix develop`, or with the toolchain from "Without Nix" plus Node 22 and Docker.

```sh
# A local Stellar network, RPC at http://localhost:8000/rpc
docker run --rm -d -p 8000:8000 --name stellar-local \
  stellar/quickstart --local --enable core,rpc

npm ci                                         # JS dependencies, including the harness
stellar contract build                         # contract wasms
npm run build:clients                          # TypeScript clients from the wasms
HARNESS_NETWORK=local npm run deploy -w scripts/harness
```

`HARNESS_NETWORK` defaults to `local`; `testnet` deploys to testnet and rewrites
the addresses table above. The local deploy funds its accounts from the
quickstart root key, so it needs no `stellar keys` identity.

Output of a real run from a fresh clone. Contract IDs differ on every run.

```text
> @strata-vault-kit/harness@0.1.0 deploy
> tsx deploy.ts

deploying to local (http://localhost:8000/rpc)
funded 13 accounts
asset contract CB7IYQNW5Z5NY4RLR3PRNDAI6DNCEXD6I7NRWQZSGBNQ6YFANFPZ7ZSE
compliance CBNEUKZOUMYIGZYCCEKNVRMLPBOCMRSE32XRGEL64QKYAHOAQTL4R2I4
identity_verifier CBZC4FWQD33HC4TKOIODFLX7H527XVP6RL346LPYSLE2GUKMFN7HT6TZ
share_token CD6ISWB4DFY6XQEXS4ECBWA3TDGOUTK7SEACMVBUEQ3JFW65XMG43QFV
nav_oracle CCAMOCE2U5LBMEYDNXAMOZZSGDTX6A5DNQRXCYMUIYFTPRKZS6QUCDKD
async_vault CAZPVYS3JITMZYE2CYBOKJ2FBQ46RK4E4NBDHA53RSV7ICUXFZOOJJYR
clients generated
vault holds share_token manager role
vault is allowlisted
share_token bound to compliance
wrote deployed.local.json
```

The addresses land in `scripts/harness/deployed.local.json`. Then run the
integration suites against that deployment:

```sh
npm run test:happy-path -w scripts/harness
npm run test:guards -w scripts/harness
```


## Reference base

Built on our own
[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp),
a working testnet demo. This repo is the productized version of it: code moves
across deliberately, with the roles, pause and configuration the demo never had.

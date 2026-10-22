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
- [Testing](./docs/TESTING.md) — which tests cover storage and TTL, auth,
  ledger time, events and calls between contracts.

## Status

Pre-release, testnet only. Nothing here is audited or production-ready.

## Deployed addresses

Testnet only. The deploy script rewrites the table below on every testnet
deploy from `environments.toml` → `[staging.contracts]`, which is the record.

<!-- deployed-addresses:start -->
| Contract | Address |
| --- | --- |
| `async_vault` | `CAXGUAAIZOCM6FIQ6PRTQEBBZG62GMN422TNT6N6UMIYY4HGFLJDUFCV` |
| `nav_oracle` | `CBYVXBRLCKJTH56FVIZFBX7XUIBOLJOROP2DM4NYA4V6FOTTFZO7VJPL` |
| `share_token` | `CCBANVMWNZXZ46WMV7N7EDGBPW3LIFOXZLILIOTRDTE63H4QXBM7XVYF` |
| `identity_verifier` | `CBLCGV3YT5AM7ZQNFEIEX3FLA3ZY3XDVW3U2YQO4ZWSJVI47763LLL5T` |
| `compliance` | `CA45ZSCHMNUMJEF2UDUT4UMCKHHMEG3LYYIB7QBK6LG2NIC7JYZ7XKRA` |
| `asset` | `CCTSSUV5XYKFEMT44SJBS2GUNBEMMRUQXLK422RAJMPTGLF7WV6ALDKR` |
<!-- deployed-addresses:end -->

## Testnet flow verification

One testnet transaction per investor-facing flow, executed through the
[live dApp](https://strata-vault-kit-app.vercel.app) against the contract IDs
above.

| Flow | Entrypoint | Transaction |
| --- | --- | --- |
| Connect wallet | — | n/a — no on-chain transaction |
| Deposit (subscribe) | `request_deposit` | [`81e9c1a9…e590`](https://stellar.expert/explorer/testnet/tx/81e9c1a95c0ba932f5d9dca7be56aa508a2bb29abd186442928342048981e590) |
| Claim shares | `claim_deposit` | [`fe59e77e…e029`](https://stellar.expert/explorer/testnet/tx/fe59e77ee68ca2849345515b5e2a8be0f80e517b49efeb22f0045a1df5a6e029) |
| Redeem (request) | `request_redeem` | [`d6c02ee0…7524`](https://stellar.expert/explorer/testnet/tx/d6c02ee0868235fd12c280ba8c4e17fd6d63f4a117e9c48a897185c72dc97524) |
| Withdraw (claim cash) | `claim_redeem` | [`27a81778…db64`](https://stellar.expert/explorer/testnet/tx/27a8177877ecac5a4c87c1b4bed12e5f8664ca387f13fd9c05f8062ec68bdb64) |

## Demo deployment

The Tranche 1 demo video was recorded on testnet against the team's E2E
testing deployment, deployed from `main` at `45e0e23` on 2026-10-20 (ledger
5299871). It is a separate instance from the one listed under
[Deployed addresses](#deployed-addresses). No contract source has changed on
`main` since `45e0e23`, so its contract code is the same as `main`.

| Contract | Address |
| --- | --- |
| `async_vault` | `CAGHFSATIJHNDXQA577APGG6GF2L7Q7KP6H2IUXVW6IT3CJ2OBE3QCEB` |
| `nav_oracle` | `CDDRBLB3GHZGKHGFATZBKFSXC6XRVFLHNPVWHTIE67FVNDYHU2RRRNRO` |
| `share_token` | `CCB23VF4CSI7QNWNDOAAAVOKOLWO5EEQFZIODWEXHS6OB3MMHGFZ3VA6` |
| `identity_verifier` | `CDMV7DGGLGIWDWI4ERIBZ5YS2FZA3QVZPVUWCAWR5VBLVJMLFYCW6DML` |
| `compliance` | `CCCA6XDCXBZWWTIDYGLTL5GEHROCZTGYAIRAFA2KBO2JAWOJFU3TMZCB` |
| `asset` | `CAU7LDCUCLAWSJZS72B7VIPIE7FSN3T63D7MZMSSXTNLKYDYECVGH522` |

Test USDC: code `USDC`, issuer
`GCUYFZRTNQ6WIIN5XBEYWVENKNVCBPK5BRXK4PDBCOGCYA4BZIRGMVIN`.

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

The first deploy writes a secret key for each harness account to
`.env.keys.<network>` at the repository root, and later deploys reuse them. Back
that file up and never commit it. The
[harness README](./scripts/harness/README.md#account-keys) explains how to use a
key you already hold for an account.

Output of a real run from a fresh clone. Contract IDs differ on every run.

```text
> @strata-vault-kit/harness@0.1.0 deploy
> tsx deploy.ts

deploying to local (http://localhost:8000/rpc)
account keys in .env.keys.local (13 new)
funded 13 accounts; 0 already existed
asset contract CDKWXRAHPQVFOAEBOOWWR62ZXAE2IV4V47PATFN7IX4XDW5QIUUL7D2B
compliance CDGKQCYSMTDRBO7SYV3V72H6AMCQ3UNQFKUU4AD5GSU2I32XDYFS6F3U
identity_verifier CCZE76VWEWJ47NSFMIXCKU3L55CZZTI5JJY4CSYAWPO3WXPDFXUCA5G6
share_token CD6IA3BOPFX7VNADJ3GFK7IZGPVPNZA6HBCF425CNPSQ2GN7QZ3UUCP2
nav_oracle CAHD5ZKMIDD67ZEJUB5ACR62FMAYMQJ2KCRV2MBDNXWT7WEZ2VV3MRDD
async_vault CDQNMAZP7D5IA7AXZGK3XWYPFD2LDR6V5HQD2OLXZJYNQN4BMNN6SXWJ
clients generated
vault holds share_token manager role
vault is allowlisted
share_token bound to compliance
wrote deployed.local.json
```

The addresses land in `scripts/harness/deployed.local.json`; a later deploy
keeps the previous file as `deployed.local.<timestamp>.json`. Then run the
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

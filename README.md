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
asset contract CCAE3ZUI4B2LSOF7HBS4F35SOHYDG7FOLSQ4DPKAS7YU3JB7IN2U2WOR
compliance CAFIN446IPMTL7E2RMHSSDFS5BRYKU6BJS7L7DBIDHLUDGPWEHVOSE2D
identity_verifier CCNJIIWUXN76GHMGNJW4WIDWYOLBGL6JPUT2J5FU2F6T74VUYNT6M7PW
share_token CCXMRDX67EUA563K3Z7BYJU5HM2PACTYQRHCGI7AXKZZDKEVZNPBYMDT
nav_oracle CDNW5MROHAB2ULG3ODWEVSMSVBTOAHDATES74HYAEZIPQCJB4HUB7KXD
async_vault CC2GSF7NZYFSUXX6UP7FFSIDXCKJV7SLN2HS7SD4XO42WHPXHQW3SJQM
clients generated
vault holds share_token manager role
share_token bound to the vault, setup finished
vault is allowlisted
share_token bound to compliance
nav_oracle bound to the vault, setup finished
vault setup finished
health {"allowlisted":true,"compliance_bound":true,"feed_valid":false,"freshness_covers_notice":true,"oracle_bound":true,"setup_open":false,"sole_token_manager":true,"token_bound":true}
wrote deployed.local.json
```

The addresses land in `scripts/harness/deployed.local.json`. Then run the
integration suites against that deployment:

```sh
npm run test:happy-path -w scripts/harness
npm run test:guards -w scripts/harness
```

Deploy afresh before each run of the suites. The guards leave the vault's
notice at 10 seconds, and lowering it back waits for the timelock, so a second
run against the same deployment can fail wherever it prices an epoch right
after closing it.

### Keeping a deployment alive

Every contract extends its own storage when it is called, but a deployment
nobody calls archives after 30 days. Restore and extend all of it with:

```sh
STELLAR_ACCOUNT=<identity or secret> npm run extend -w scripts/harness
```

It reads the testnet contracts from `environments.toml`, restores any
archived instance or Wasm, and extends each by 30 days. Any funded account
pays, since extending needs no authority. Use `--env <name>` for another
environment, or `--config <record>` for a deployment record. The
[TTL policy](./docs/kit-spec.md#5-storage-lifetime-ttl-policy) says what each
contract extends on its own.

## Reference base

Built on our own
[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp),
a working testnet demo. This repo is the productized version of it: code moves
across deliberately, with the roles, pause and configuration the demo never had.

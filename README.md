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

A request can be cancelled until the vault can read its price. Once an epoch is
sealed, a valid report accepted after the seal closes cancellation, even while
the notice still runs; the epoch is priced once the notice ends. If that report
expires, or the NAV or the vault is paused, cancellation opens again. New
deposits are refused while the valuation is stale or the NAV is paused.

## Documentation

- [Product and architecture](./docs/strata-product-and-architecture.md) — what
  the protocol does, why it is asynchronous, and how the pieces fit together.
- [Kit specification](./docs/kit-spec.md) — invariants, deploy-time
  parameters, and complete role matrix.
- [Testing](./docs/TESTING.md) — which tests cover storage and TTL, auth,
  ledger time, events and calls between contracts.
- [Threat model](./docs/THREAT_MODEL.md) — what can go wrong with the oracle,
  the roles and the redemption paths, what stops it, what is left, and the
  test for each control.
- [Monitoring plan](./docs/MONITORING_PLAN.md) — what an operator watches on
  chain, where each signal comes from, and what to do when it fires.

## Status

Pre-release, testnet only. Nothing here is audited or production-ready.

## Deployed addresses

Testnet only. The deploy script rewrites the table below on every testnet
deploy from `environments.toml` → `[staging.contracts]`, which is the record.

<!-- deployed-addresses:start -->
| Contract | Address |
| --- | --- |
| `async_vault` | `CCDWVENC7GNFO757JON65OKWJXHYIEGPVPDWVCGRZOPAHOQURPHQRPUG` |
| `nav_oracle` | `CADX6LVWOQ6DGFHEQ6AMJHDPKWOO2RTHEEIERVPWHOUJCN3WNEGYHHL3` |
| `share_token` | `CDRAUSDVE7OKWKCJJNPD4HYTMLGF5XFVG5DY7KMLQCBHJTW53TYN7UGK` |
| `identity_verifier` | `CBZEZBVOFNEYBGWRMON7WDFAXCNLH3DEAF3EDIS7PJRSLY6BK7XN5O7J` |
| `compliance` | `CDHEEBIAMKLMJHJZHQ3R63PVWQUMQAX4WY6WDODZOY2E5X5GNSFFG6DR` |
| `asset` | `CCOHKZLQ5EAD2A3RLHYHH7W4K2TNLNELXUVLWZIZALH45WXHH5H3QV7E` |
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

## Vault figures

The [live dApp](https://strata-vault-kit-app.vercel.app) shows Withdrawable and
Committed in the strip at the top of the vault page, and Economic supply under
"About this vault". Each one reads a view on `async_vault`.

| Figure | What it is | View |
| --- | --- | --- |
| Withdrawable | The cash the vault holds now, less deposits that can still be cancelled. Priced redemptions are paid from it. | `liquid_reserve()` |
| Committed | The cash owed to priced redemptions that are not claimed yet. When it is more than Withdrawable, the gap shows as Uncovered. | `committed()` |
| Economic supply | The shares held outside the vault, plus the shares priced for deposits and not claimed yet. | `total_economic_supply()` |

## Oracle tests

These tests show the oracle's price controls and how it keeps its storage
alive (TTL). Run them with `cargo test -p nav-oracle`.

| What the tests show | File | Tests |
| --- | --- | --- |
| Band: a price below the minimum or above the maximum answer is refused | [`contracts/nav-oracle/src/test.rs`](./contracts/nav-oracle/src/test.rs), [`contracts/nav-oracle/src/test_guards.rs`](./contracts/nav-oracle/src/test_guards.rs) | `attest_rejects_out_of_band`, `nav_in_band_refuses_a_value_outside_the_band` |
| Deviation cap: one report cannot move the price past the upward or downward cap | [`contracts/nav-oracle/src/test.rs`](./contracts/nav-oracle/src/test.rs), [`contracts/nav-oracle/src/test_guards.rs`](./contracts/nav-oracle/src/test_guards.rs) | `attest_enforces_cooldown_and_deviation`, `a_configured_downside_still_bounds_a_fall`, `a_full_downside_cap_still_bounds_a_rise`, `within_deviation_refuses_a_move_past_either_cap` |
| Cooldown: a report inside the cooldown after the last one is refused | [`contracts/nav-oracle/src/test.rs`](./contracts/nav-oracle/src/test.rs), [`contracts/nav-oracle/src/test_guards.rs`](./contracts/nav-oracle/src/test_guards.rs) | `attest_enforces_cooldown_and_deviation`, `two_reports_in_one_ledger_are_refused_at_the_shortest_cooldown`, `cooldown_elapsed_refuses_a_report_inside_the_cooldown` |
| Freshness: a report never outlives the freshness window, a report that is already expired is refused, and once a price expires the oracle reports it stale and the vault refuses to price an epoch with it | [`contracts/nav-oracle/src/test.rs`](./contracts/nav-oracle/src/test.rs), [`contracts/nav-oracle/src/test_guards.rs`](./contracts/nav-oracle/src/test_guards.rs), [`contracts/async-vault/src/test/oracle_pricing.rs`](./contracts/async-vault/src/test/oracle_pricing.rs) | `heartbeat_expiry_makes_it_stale`, `a_reporter_expiry_past_the_window_is_cut_to_the_window`, `expires_in_future_refuses_a_report_born_stale`, `fulfill_is_rejected_once_the_feed_goes_stale` |
| TTL: the latest valuation keeps a full TTL while it is read | [`contracts/nav-oracle/src/test.rs`](./contracts/nav-oracle/src/test.rs) | `the_latest_valuation_keeps_a_full_ttl_while_it_is_read` |
| TTL: setup, grant, hand-over and change calls extend the instance, and every role grant writes the role with its full TTL | [`contracts/nav-oracle/src/test_governance.rs`](./contracts/nav-oracle/src/test_governance.rs) | `setup_grants_hand_overs_and_changes_restore_the_instance_ttl`, `the_constructor_writes_each_role_with_the_full_ttl`, `a_grant_during_setup_writes_the_role_with_the_full_ttl`, `a_grant_through_the_timelock_writes_the_role_with_the_full_ttl` |

The vault's test runs with `cargo test -p async-vault
fulfill_is_rejected_once_the_feed_goes_stale`. [Testing](./docs/TESTING.md)
lists the TTL tests for every contract.

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
  stellar/quickstart --local --enable core,rpc --protocol-version 30

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
asset contract CCW7OKVOXBBBX3YK6O7F6TZPNIFG32OG4UY7R2K6NSWZUI4R75QCEPVT
compliance CDPCD2BQQKVQBQFAFI4YBLN3TRX34J5NZUQQMUBGHPYNY64LCEM63DTL
identity_verifier CC4SRUIMKOBZSEO2GKGVQMDWPWCBJBBIMYYE7BBCUEZE6VMD3SFQDAMW
share_token CDC7SRTDZIMJSLC5AONUD3FIFYZGMFOHRAS7LLYV2ATJRT7RMTMQO2DG
nav_oracle CCUUBP3RGOIZZL4DUGRL4FBOSQJZKBPNQ7VUWIN6UOOYBJYYKGNT5E52
async_vault CB2KVM2WHLXDZRHGCYPTGE7PZM6OORXCNVBUMC3L7GY5KX4BA6NMADXE
clients generated
vault holds share_token manager role
share_token bound to the vault, setup finished
vault is allowlisted
share_token bound to compliance
compliance bound to the vault, setup finished
nav_oracle bound to the vault, setup finished
vault setup finished
health {"addresses_distinct":true,"allowlisted":true,"compliance_bound":true,"custodian_set":true,"decimals_match":true,"feed_answers":true,"feed_valid":false,"freshness_covers_notice":true,"oracle_bound":true,"setup_open":false,"sole_token_manager":true,"token_bound":true,"vault_unfrozen":true}
wrote deployed.local.json
```

The addresses land in `scripts/harness/deployed.local.json`; a later deploy
keeps the previous file as `deployed.local.<timestamp>.json`. Then run the
integration suites against that deployment:

```sh
npm run test:happy-path -w scripts/harness
npm run test:guards -w scripts/harness
CARGO_TARGET_DIR=target/short-wind-down stellar contract build --package async-vault --features short_wind_down
npm run test:wind-down -w scripts/harness
```

Deploy afresh before each run of the suites. The guards leave the vault's
notice at 10 seconds, and lowering it back waits for the timelock, so a second
run against the same deployment can fail wherever it prices an epoch right
after closing it. `test:wind-down` ignores `deployed.local.json`: it deploys
its own throwaway vault set, built from the `short_wind_down` wasm above, so
it can reach an active wind-down without the real seven-day minimum.

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

With `--config`, it uses the network the record names (`local` or `testnet`)
unless `--env` names another environment, and it prints the network and RPC it
uses before it sends anything. Put flags after `--`, or npm swallows them:
`npm run extend -w scripts/harness -- --config <record>`.

## Reference base

Built on our own
[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp),
a working testnet demo. This repo is the productized version of it: code moves
across deliberately, with the roles, pause and configuration the demo never had.

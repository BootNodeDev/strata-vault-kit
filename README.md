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
   valuation can block an already-priced, funded cash claim. A compliance
   freeze holds it until the freeze is lifted.

A request can be cancelled until the vault can read its price. Once an epoch is
sealed, a valid report accepted after the seal closes cancellation, even while
the notice still runs; the epoch is priced once the notice ends. If that report
expires, or the NAV or the vault is paused, cancellation opens again. New
deposits are refused while the vault is paused, while the valuation is stale
or the NAV is paused, while an issuer clawback leaves the vault holding less
than its pending deposits, and once a wind-down is proposed.

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
- [Grant differences](./docs/GRANT_DIFFERENCES.md) — where the built kit
  differs from the SCF grant proposal, what is not built yet, and the limits an
  adopter should know.

## Status

Pre-release, testnet only. Nothing here is audited or production-ready.

## Deployed addresses

Testnet only. The deploy script rewrites the table below on every testnet
deploy from `environments.toml` → `[staging.contracts]`, which is the record.

<!-- deployed-addresses:start -->
| Contract | Address |
| --- | --- |
| `async_vault` | `CDJHQ2R5XUJGP6WUKCW4VBEVGWFAZ5TZLEONBITKITNXFDLWNNK7WVYO` |
| `nav_oracle` | `CCZ4X25GLMYRQ33PM4ZYDMGKAJJKPUG2ABUZ4NIGUSA7W4RUTBOEEDYI` |
| `share_token` | `CDOZT5VNIKSLQSFELF4PHVZRZA3GCJYJEHVDZTUB7O2QMBHBKKOYORQI` |
| `identity_verifier` | `CCGHNGPI66WGVSLLALQVCIRIOZKX73QW23UDZLZ3LMXLGEG7SLVUOULD` |
| `compliance` | `CCQI5NFRWBOO77LYSFY54D6PSU4TVWD5A3CFX2A5AWLEURVR35XISMKG` |
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

## Redemption queue

The notice-period queue on testnet, against the contract IDs above, run by the
harness scenario [`redemption-queue.test.ts`](./scripts/harness/redemption-queue.test.ts)
on 2026-11-02. Repeat it on a seeded deployment:

```sh
HARNESS_NETWORK=testnet npm run seed                            # once: holders hold shares
HARNESS_NETWORK=testnet npm run test:queue -w scripts/harness   # prints `tx <label> <hash>`
```

The treasury deploys the free reserve first, so the redemption that follows is
larger than the cash left in the vault. All steps are in epoch 3.

| Step | Account | Entrypoint | Transaction |
| --- | --- | --- | --- |
| Deploy the free reserve to the custodian (5,499 USDC) | treasury | `deploy_to_custodian` | [`93f5fad4…3c59`](https://stellar.expert/explorer/testnet/tx/93f5fad45b33751197ee31de6062a70dbff058d69a98fc176aa8f193a5c93c59) |
| Request a redemption (10 shares) | holder-2 | `request_redeem` | [`3c507d84…ee38`](https://stellar.expert/explorer/testnet/tx/3c507d84b1b5bc40d1fd4fc231731f28ccef7aaaaa126a3ec07e16a9315aee38) |
| Cancel it before the epoch closes | holder-2 | `cancel_redeem` | [`bd35fdcd…15c6`](https://stellar.expert/explorer/testnet/tx/bd35fdcd76cae0938b753926c1b2094a660c49b0199cbccab4479678ef6d15c6) |
| Request again (1,001 shares) | holder-2 | `request_redeem` | [`0b72ab37…4681`](https://stellar.expert/explorer/testnet/tx/0b72ab37c7057aae3fe5466d4dc906a14bf54db20a900535d7a3be24066e4681) |
| Seal the epoch | manager | `close_epoch` | [`d1f52849…7ec3`](https://stellar.expert/explorer/testnet/tx/d1f528498e377777bf3dc941c137dbaf6653cc0ff4821b9563fffa7797a77ec3) |
| Attest the NAV | attester | `attest` | [`14daff3d…3543`](https://stellar.expert/explorer/testnet/tx/14daff3d640ebb5b84ca71cc2ba9326b43a57d3f50855adb70bf657b710e3543) |
| Price the epoch | any account | `fulfill_epoch` | [`2f3b4564…9902`](https://stellar.expert/explorer/testnet/tx/2f3b4564afd92014d0db369a707e9f82eb0d16cd107e7c41a0b1afea9c689902) |
| Return the capital | custodian | `fund` | [`074cc4be…24fd`](https://stellar.expert/explorer/testnet/tx/074cc4be2972a3ff27f3ea6ea332fa3a97da04bd460ef39eaf8c12abb71924fd) |
| Claim the cash (1,001 USDC) | holder-2 | `claim_redeem` | [`8d169333…0eee`](https://stellar.expert/explorer/testnet/tx/8d169333d36a929616df933d64aa67b8e075a886d07b40d007b0d8696a180eee) |

Once the epoch is priced the vault owes 1,001 USDC more against 1,000 USDC of
liquid reserve, so `uncovered()` is above zero. The claim at that point is
refused with `ClaimNotCovered`. It fails at simulation and leaves no
transaction, so the evidence of the short reserve is the pricing transaction
before it and the `fund` that clears it.

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
| Band: a price below the minimum or above the maximum answer is refused | [`contracts/nav-oracle/src/test/oracle.rs`](./contracts/nav-oracle/src/test/oracle.rs), [`contracts/nav-oracle/src/test/guards.rs`](./contracts/nav-oracle/src/test/guards.rs) | `attest_rejects_out_of_band`, `nav_in_band_refuses_a_value_outside_the_band` |
| Deviation cap: one report cannot move the price past the upward or downward cap | [`contracts/nav-oracle/src/test/oracle.rs`](./contracts/nav-oracle/src/test/oracle.rs), [`contracts/nav-oracle/src/test/guards.rs`](./contracts/nav-oracle/src/test/guards.rs) | `attest_enforces_cooldown_and_deviation`, `a_configured_downside_still_bounds_a_fall`, `a_full_downside_cap_still_bounds_a_rise`, `within_deviation_refuses_a_move_past_either_cap` |
| Cooldown: a report inside the cooldown after the last one is refused | [`contracts/nav-oracle/src/test/oracle.rs`](./contracts/nav-oracle/src/test/oracle.rs), [`contracts/nav-oracle/src/test/guards.rs`](./contracts/nav-oracle/src/test/guards.rs) | `attest_enforces_cooldown_and_deviation`, `two_reports_in_one_ledger_are_refused_at_the_shortest_cooldown`, `cooldown_elapsed_refuses_a_report_inside_the_cooldown` |
| Freshness: a report never outlives the freshness window, a report that is already expired is refused, and once a price expires the oracle reports it stale and the vault refuses to price an epoch with it | [`contracts/nav-oracle/src/test/oracle.rs`](./contracts/nav-oracle/src/test/oracle.rs), [`contracts/nav-oracle/src/test/guards.rs`](./contracts/nav-oracle/src/test/guards.rs), [`contracts/async-vault/src/test/oracle_pricing.rs`](./contracts/async-vault/src/test/oracle_pricing.rs) | `heartbeat_expiry_makes_it_stale`, `a_reporter_expiry_past_the_window_is_cut_to_the_window`, `expires_in_future_refuses_a_report_born_stale`, `fulfill_is_rejected_once_the_feed_goes_stale` |
| TTL: the latest valuation keeps a full TTL while it is read | [`contracts/nav-oracle/src/test/oracle.rs`](./contracts/nav-oracle/src/test/oracle.rs) | `the_latest_valuation_keeps_a_full_ttl_while_it_is_read` |
| TTL: setup, grant, hand-over and change calls extend the instance, and every role grant writes the role with its full TTL | [`contracts/nav-oracle/src/test/governance.rs`](./contracts/nav-oracle/src/test/governance.rs) | `setup_grants_hand_overs_and_changes_restore_the_instance_ttl`, `the_constructor_writes_each_role_with_the_full_ttl`, `a_grant_during_setup_writes_the_role_with_the_full_ttl`, `a_grant_through_the_timelock_writes_the_role_with_the_full_ttl` |

The vault's test runs with `cargo test -p async-vault
fulfill_is_rejected_once_the_feed_goes_stale`. [Testing](./docs/TESTING.md)
lists the TTL tests for every contract.

## Admin panel

The operations console is at
[strata-vault-kit-app.vercel.app/admin](https://strata-vault-kit-app.vercel.app/admin).
It reads the contracts the console and the transactions below ran against, not
the set under [Deployed addresses](#deployed-addresses):

| Contract | Address |
| --- | --- |
| `async_vault` | `CD5LYYXGOJ7R23P6D7YUN6DUJQYMI23KEUEOIFKXOSWOX3KHKTXRITED` |
| `nav_oracle` | `CBKVMUMIX7MXYHX5K34N5HYZOP6S2VGWF7MN27RIWBV3A3WD3X3L63CO` |
| `share_token` | `CDOISQTQRCYOTH6S3DFQ6UKJ2TEXLNO7NFIGOZS4RZL63IRCVXXCGP5N` |
| `identity_verifier` | `CCTCCY7AVFAIRGEWWJZT2UDMBHS3NGNKVUWLY43CHDNN75AQEV6P3EOY` |
| `compliance` | `CDEH6FJBK7NDFLALO3X3GDXZUREYHUSNC7ODPM64RBG3BBXW2USMW7OO` |

One testnet transaction per privileged operation, each made through the console
(not by script) and signed by the account that holds that authority, against
those contracts. Every authority account has a single signer (weight 1) and the
default thresholds, so each transaction carries one signature. Multisig is left
to deployers. The transactions ran on 2026-11-02.

| Authority | Account | Signers | Threshold |
| --- | --- | --- | --- |
| Governance | `GAM3QHYPTTVFOHS2JPCRXL2X2JSH44P4NKKSPR75G47LOOXVR7OGX5AP` | 1 | 1 |
| Manager | `GBFFWDAHPSD7H4BQQCC6FMPKW5S6KZL25WCYJRRNGXS7IB7X75N3VXR4` | 1 | 1 |
| Treasury | `GA6UJXW73VJVKLU3ACZPZLPAVH5UTIIGIFGVOKQTF52AIPFXRTQ7U6CN` | 1 | 1 |
| Guardian | `GDKSNPH4PBAYAHMBLWMESCS2AWRUGCXB3Z3AQKG5TKQF7A3GAROWZPPX` | 1 | 1 |
| Attester | `GD4RCWJADWPH5UMT4QJ2GSVSTS4PNQ3L36OW2HEDRCNRWKZPFQV2NGHI` | 1 | 1 |
| Compliance | `GBYDLIMNUC5RTDMQHZKIRHL5ALCF3PLJAPCMHOHEJ2C6GPUBCW3GSM4A` | 1 | 1 |

| Authority | Operation | Entrypoint | Transaction |
| --- | --- | --- | --- |
| Manager | Close an epoch | `close_epoch` | [`b245b6b7…ebb4`](https://stellar.expert/explorer/testnet/tx/b245b6b7e43a483397d76ac761ccc8c51dc2c6e0dfcbc92a3fec5ddc5ddfebb4) |
| Attester | Attest the NAV | `attest` | [`2a5b9065…d2b3`](https://stellar.expert/explorer/testnet/tx/2a5b90652691e98ddb8e56900bf78409dcbe72b4e1d10b4cb595043e8a22d2b3) |
| Treasury | Deploy to the custodian | `deploy_to_custodian` | [`42805dc6…f835`](https://stellar.expert/explorer/testnet/tx/42805dc6546c6d4fd9d63e19e92219007500c4850b8a0b9ff3f1dc56826ef835) |
| Guardian | Pause the vault | `pause` | [`0ca2701c…0267`](https://stellar.expert/explorer/testnet/tx/0ca2701c9e33f9a7e6d015c716678fb78adb7166cf4c4efa6482849dc8850267) |
| Guardian | Pause the NAV (raise the ripcord) | `raise_ripcord` | [`1c2a59e6…6152`](https://stellar.expert/explorer/testnet/tx/1c2a59e6eb9af567eeb012fc8470f101bab03776136a337f3c83d87906cb6152) |
| Governance | Unpause the vault | `unpause` | [`2163860b…0292`](https://stellar.expert/explorer/testnet/tx/2163860bdd2988ad3110f399d5a465cd30c819158d7461263f0db2a44cdf0292) |
| Governance | Lower the ripcord | `set_ripcord` | [`38fab33d…44f4`](https://stellar.expert/explorer/testnet/tx/38fab33dca6981b3889bcd5409cab29480364c56cbcd9d7177bcdb58a86f44f4) |
| Governance | Pause the share token | `pause` | [`a0585500…1391`](https://stellar.expert/explorer/testnet/tx/a05855005867f9ea24af68bc5b06838f87ad3fdfef9d1b565dd646e01b241391) |
| Governance | Unpause the share token | `unpause` | [`d16400cf…f07c`](https://stellar.expert/explorer/testnet/tx/d16400cf5125e3a147b0f985f474c0daf57a2966b8a54369d9c7e16a3d0df07c) |
| Compliance | Allow an investor | `allow` | [`5671fb19…ea35`](https://stellar.expert/explorer/testnet/tx/5671fb19436534260fba1ec3f9be6a0d25e12ea93e3b7601ea60f802e011ea35) |
| Compliance | Freeze an address | `set_address_frozen` | [`8e6556db…48fb`](https://stellar.expert/explorer/testnet/tx/8e6556dbf0d3a56efce4f115a34f70acdf048addba3c9592b579dd19377148fb) |
| Compliance | Unfreeze an address | `set_address_frozen` | [`d4ee95a6…1469`](https://stellar.expert/explorer/testnet/tx/d4ee95a617d5a10e564e08e3f29dab56cbb06e4506b7a19aae512dbdb5a71469) |
| Compliance | Remove an investor (Disallow in the console) | `allow` with `false` | [`d8154ca3…ab36`](https://stellar.expert/explorer/testnet/tx/d8154ca32e99304728a14f6edefdfa053b7ba542e84b77cdb21246b56855ab36) |

Not recorded:

- **A timelocked change, proposed and applied** (`propose_upgrade`,
  `apply_upgrade`): the vault's upgrade delay is seven days, its minimum, longer
  than this verification.
- **A wind-down proposal** (`propose_wind_down`): the deployment's
  `wind_down_delay` is zero, so anyone could activate the wind-down in the next
  ledger, and activation cannot be undone.
- **`legal_transfer`, co-signed by governance:** the contracts above predate
  it. Their console offers `forced_transfer`.

The share token is paused by governance, not the guardian: the guardian holds no
role on the token.

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
cargo install --locked stellar-cli@27.0.0
stellar contract build && cargo test
```

Formatting and secret-scanning run on commit via a `prek` hook — see
`.pre-commit-config.yaml` and run `prek install` once. CI also scans every
pull request's commits with the same gitleaks version.

### Console and script tests

The tests and the type check for `app/`, `app-lib/` and `scripts/` run against
the TypeScript clients generated from the contracts. Generate them once, and
again after a contract's interface changes:

```sh
npm ci
stellar contract build && npm run build:clients
npm run test        # stops and names any client that is missing
npm run typecheck   # app, app-lib and the harness
```

### Integration & On-Chain Tests

From a fresh clone to a vault set deployed on a local network. Run these inside
`nix develop`, or with the toolchain from "Without Nix" plus Node 22 and Docker.

```sh
# A local Stellar network, RPC at http://localhost:8000/rpc
docker run --rm -d -p 8000:8000 --name stellar-local \
  docker.io/stellar/quickstart:v687-b1580.1-latest@sha256:7711899e9942c60316ebacf8ab901be15bed7a5a31705d847b55375ff3bc8356 \
  --local --enable core,rpc --protocol-version 30

npm ci                                         # JS dependencies, including the harness
stellar contract build                         # contract wasms
npm run build:clients                          # TypeScript clients from the wasms
HARNESS_NETWORK=local npm run deploy -w scripts/harness
```

`HARNESS_NETWORK` defaults to `local`; `testnet` deploys to testnet and rewrites
the addresses table above and `[staging.contracts]` in `environments.toml`.
Commit both files after a testnet deploy: the app's build reads those IDs, so
until the change is committed it points at the previous contracts. The local
deploy funds its accounts from the quickstart root key, so it needs no
`stellar keys` identity.

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
returned the deposit asset of 0 accounts to its issuer
compliance CDPCD2BQQKVQBQFAFI4YBLN3TRX34J5NZUQQMUBGHPYNY64LCEM63DTL
identity_verifier CC4SRUIMKOBZSEO2GKGVQMDWPWCBJBBIMYYE7BBCUEZE6VMD3SFQDAMW
share_token CDC7SRTDZIMJSLC5AONUD3FIFYZGMFOHRAS7LLYV2ATJRT7RMTMQO2DG
nav_oracle CCUUBP3RGOIZZL4DUGRL4FBOSQJZKBPNQ7VUWIN6UOOYBJYYKGNT5E52
async_vault CB2KVM2WHLXDZRHGCYPTGE7PZM6OORXCNVBUMC3L7GY5KX4BA6NMADXE
commit <sha>
clients generated
vault holds share_token manager role
share_token bound to the vault, setup finished
vault is allowlisted
share_token bound to compliance
compliance bound to the vault, setup finished
nav_oracle bound to the vault, setup finished
vault notice set to 10 seconds
vault minimum epoch duration set to 86400 seconds
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

Deploy afresh before each run of the suites. The deploy sets the vault's
notice to twice the oracle cooldown (10 seconds on the local network, 120 on
testnet), and the suites wait out the notice before they price an epoch. It
also sets a minimum epoch duration of one day on every network, so an
outsider can eventually seal an epoch the manager leaves open; the guards
suite checks the refusal before that minimum elapses, since waiting a real
day is not practical for a test run.
`test:wind-down` ignores `deployed.local.json`: it deploys its own throwaway
vault set, built from the `short_wind_down` wasm above, so it can reach an
active wind-down without the real seven-day minimum.

Each deploy first returns any deposit asset the harness accounts hold to its
issuer, so every holder starts a new set at zero. Deploy again and the suites
run again on the same network.

### Keeping a deployment alive

Every contract extends its own storage when it is called, but a deployment
nobody calls archives after 30 days. Keep the contracts callable with:

```sh
STELLAR_ACCOUNT=<identity or secret> npm run extend -w scripts/harness
```

It reads the testnet contracts from `environments.toml` and covers three kinds
of entry: each contract instance, the Wasm it runs and each pending timelock
change. It restores any of them that has archived, then extends each by 30
days. Any funded account pays, since extending needs no authority. Use
`--env <name>` for another environment, or `--config <record>` for a
deployment record.

It extends nothing else. Other entries, such as epochs, requests, balances and
roles, still archive when nobody uses them. Nothing in them is lost: the next
call that needs an archived entry restores it, and the account that sends that
call pays the restore fee. For a holder's balance or request, that is usually
the holder, on their next call. The
[TTL policy](./docs/kit-spec.md#5-storage-lifetime-ttl-policy) says what each
contract extends on its own and how a restore works.

With `--config`, it uses the network the record names (`local` or `testnet`)
unless `--env` names another environment, and it prints the network and RPC it
uses before it sends anything. Put flags after `--`, or npm swallows them:
`npm run extend -w scripts/harness -- --config <record>`.

## Reference base

Built on our own
[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp),
a working testnet demo. This repo is the productized version of it: code moves
across deliberately, with the roles, pause and configuration the demo never had.

# Security scan

The results of the self-service security tools from
[Stellar's list](https://developers.stellar.org/docs/tools/developer-tools/security-tools)
on Strata's contracts, every finding with its triage, and the plan for what
stays open. Scout is the tool of record: its version, command and raw report
are below. Three more ran on the same code: Almanax, Certora Sunbeam, and a
check against the Soroban Security Portal.

Every finding was checked by hand against the code. A tool's severity is its
own label; the triage is ours.

## Scope

- **Code.** The `tranche2` tag, commit `db90b95`. Almanax, Certora and the
  portal check ran on it on 10 November 2026. Scout ran on 12 November 2026 on
  a copy of commit `56b22d1`, whose contracts, crates and lockfile are the same
  as the tag's.
- **Contracts.** `async-vault`, `share-token`, `nav-oracle`,
  `identity-verifier` and `compliance`, and the shared crates `strata-bindings`,
  `strata-storage` and `strata-timelock`.
- **Not covered.** The web app, the deployment scripts and settings, and the
  OpenZeppelin libraries themselves. This is an automated sweep with a manual
  triage, not an audit.

## Result

- Every critical, high and medium finding from Scout and Almanax is a false
  positive or behaviour the design chose.
- One new bug, rated low: a zero-asset redemption from a delisted holder stays
  stuck ([#445](https://github.com/BootNodeDev/strata-vault-kit/issues/445)).
- Certora proved the pricing and oracle guard math, reproduced the known
  [#434](https://github.com/BootNodeDev/strata-vault-kit/issues/434), and showed
  the state behind [#435](https://github.com/BootNodeDev/strata-vault-kit/issues/435)
  is reachable. Both are medium bugs, open, and in the remediation plan.

Triage values: **Fixed** (with its PR), **Open** (with its issue), **False
positive** (the tool is wrong, and why), **Accepted** (the tool is right about
the behaviour and the design chose it, and why).

## Scout

[Scout](https://www.coinfabrik.com/products/scout), CoinFabrik's static
analyzer, flags code patterns that are often risky without running the code.
It rates each pattern, not its real impact, so its "Critical" does not mean a
critical bug.

- **Version.** `cargo-scout-audit 0.3.17`, from the Docker image
  `coinfabrik/scout:0.3.17`
  (`sha256:216faf0b3c413cbe69770b0e2f999b9d45fa5bcb481940e8af4be1a48a7a54a5`).
  Its detectors build with the toolchain `nightly-2025-09-18`.
- **Crates.** One run over the whole Cargo workspace. Scout reports all eight
  crates analysed: the five contracts and the three shared crates.
- **Command.**

  ```sh
  docker run --rm --platform linux/amd64 \
    -e INPUT_TARGET=/scoutme -e INPUT_SCOUT_ARGS="--output-format json,md" \
    -v "<copy of the repository>:/scoutme" coinfabrik/scout:0.3.17
  ```

  It ran on a copy of the repository so its build output stayed out of the
  working tree. A git hook worked around a branch rename in one of Scout's
  dependencies: dylint checks out rust-clippy's `master` branch, which is now
  `main`. [`command.txt`](./evidence/scout/command.txt) has every step.
- **Raw report.** [`scout-report.json`](./evidence/scout/scout-report.json),
  [`scout-report.md`](./evidence/scout/scout-report.md) and the console output
  [`scout-console.log`](./evidence/scout/scout-console.log). The summary list at
  the top of the markdown report miscounts two categories; its sections and the
  JSON give the right counts.

28 hits from 6 detectors, none of them a real bug. They are the same 28, at the
same lines, as an earlier Scout run on the `tranche2` tag.

### Integer overflow or underflow: 9 hits, Scout "Critical", false positive

The release build sets `overflow-checks = true` ([`Cargo.toml`](../Cargo.toml)),
so an overflow aborts the transaction instead of producing a wrong number. None
of these lines can reach the limits with real values.

| Location | Code | Why it cannot overflow |
| --- | --- | --- |
| `contracts/async-vault/src/treasury.rs:25` | `held(e) - state::cancellable_escrow(e)` | Two amounts of the deposit asset, bounded by its supply |
| `contracts/async-vault/src/treasury.rs:31` | `(liquid_reserve(e) - state::committed(e) - wind_down::owed(e)).max(0)` | Amounts of the asset; the result stops at zero |
| `contracts/async-vault/src/treasury.rs:38` | `(state::committed(e) - liquid_reserve(e)).max(0)` | Amounts of the asset; the result stops at zero |
| `contracts/async-vault/src/lock_policy.rs:100` | `(balance - frozen).max(0)` | Share amounts; the result stops at zero |
| `contracts/nav-oracle/src/guards.rs:148` | `nav_per_share - last.nav_per_share` | Both prices sit inside the oracle's band |
| `contracts/nav-oracle/src/guards.rs:149` | `last.nav_per_share * (bps as i128) / BPS_DENOM` | A price inside the band times at most 10,000 |
| `contracts/async-vault/src/wind_down.rs:188` | `wd.round += 1` | A `u32` round counter: about 4 billion rounds |
| `crates/strata-timelock/src/queue.rs:53` | `id + 1` | A `u32` change id: about 4 billion proposals |
| `contracts/async-vault/src/governance.rs:181` | `i + 1` | An index in a check over four addresses |

### Storage operation without access control: 5 hits, Scout "Medium", false positive

None of the five lets an outsider grow storage or make others' calls fail.

| Location | Code | Why |
| --- | --- | --- |
| `crates/strata-timelock/src/queue.rs:51` | `open.push_back(id)` when a change is proposed | Only the admin proposes, and the queue refuses a new entry once 16 wait (`MAX_PENDING`, checked at `queue.rs:41`) |
| `contracts/async-vault/src/governance.rs:312` | `out.push_back` in `pending()` | A list built in memory for a read-only view, over at most 16 ids |
| `contracts/compliance/src/governance.rs:145` | `out.push_back` in `pending()` | Same |
| `contracts/nav-oracle/src/governance.rs:157` | `out.push_back` in `pending()` | Same |
| `contracts/share-token/src/governance.rs:174` | `out.push_back` in `pending()` | Same |

### Soroban version: 8 hits, Scout "Enhancement", accepted

One hit per crate, at `lib.rs:1`, because `soroban-sdk` is pinned to `26.1.1`
and Scout sees `29.0.1` as the latest. The pin is deliberate: it matches the
OpenZeppelin `0.7.2` libraries, and the repository upgrades dependencies only
between milestones, each migration as its own issue
([AGENTS.md](../AGENTS.md)). The hits are in `async-vault`, `share-token`,
`nav-oracle`, `compliance`, `identity-verifier`, `strata-bindings`,
`strata-storage` and `strata-timelock`.

### No event on a storage change: 4 hits, Scout "Enhancement", false positive

| Location | Entrypoint | Events it publishes |
| --- | --- | --- |
| `contracts/async-vault/src/lib.rs:891` | `claim_deposit` | `DepositClaimed`, or `DepositRefunded`; `EpochReconciled` when the epoch settles |
| `contracts/async-vault/src/lib.rs:923` | `cancel_deposit` | `DepositCancelled` |
| `contracts/async-vault/src/lib.rs:956` | `cancel_redeem` | `RedeemCancelled` |
| `contracts/async-vault/src/lib.rs:1030` | `claim_redeem` | `RedeemClaimed`, or `RedeemCancelled` when a zero-asset claim returns the shares; `EpochReconciled` when the epoch settles |

Each entrypoint calls into `deposit.rs` or `redeem.rs`, which publish the
events; Scout does not follow the call from `lib.rs`. Tests:
`cancelling_a_deposit_publishes_the_cancellation`,
`cancelling_a_redemption_publishes_the_cancellation` and
`claiming_the_last_deposit_publishes_the_shares_paid_and_the_settlement` in
[`events.rs`](../contracts/async-vault/src/test/events.rs).

### `assert!` may panic: 1 hit, Scout "Enhancement", false positive

`crates/strata-bindings/src/errors.rs:39`. The `assert!` sits inside a
`const _: () = { … }` block, so it runs when the crate compiles: it stops the
build if two contracts' error-code ranges overlap, and never runs on chain.

### Unused return enum: 1 hit, Scout "Minor", accepted

`contracts/async-vault/src/lib.rs:1307`, `Ok(governance::clock(e))`. `clock()`
returns a `Result` because it implements the shared `TimelockHost` trait, where
another contract's clock can fail. The vault's never does; the `Result` costs
nothing.

## Almanax

An AI auditor that reads the whole repository. 12 findings, all closed.

| Id | Finding | Almanax | Triage | Why | Where we checked |
| --- | --- | --- | --- | --- | --- |
| A1 | The constructor can be called after deploy and reset the admin | High | False positive | `__constructor` runs only when the contract is created and never again, not even on an upgrade. Even if it ran, OpenZeppelin's `set_admin` refuses when an admin exists. | `contracts/share-token/src/contract.rs:48-66`; `stellar-access` `access_control/storage.rs:151-155` |
| A2 | The compliance hooks do not check the token's signature | Medium | False positive | The hooks `transferred`, `created` and `destroyed` start with `require_auth_from_bound_token`: only the bound token can call them. | `contracts/compliance/src/lib.rs:468-529`; `stellar-tokens` `rwa/compliance/storage.rs:194, 224, 254, 361-369` |
| A3 | Cancellation reopens when the oracle becomes unreadable | Medium | Accepted | The design reopens cancellation when the vault can no longer price a sealed epoch, so escrow is never stuck behind a dead feed. Only trusted roles or a report's expiry make the feed unreadable, and anyone can price while it is readable. | `contracts/async-vault/src/epoch.rs:28-63`; design doc, cancellation |
| A4 | Anyone can time which report prices an epoch | Medium | Accepted | An epoch is priced at the latest valid report at fulfil time. Requests are fixed at the seal; the only choice left is among reports accepted after it, limited by the cooldown and the maximum move. A keeper that fulfils as soon as the notice ends removes the choice (remediation plan). | `contracts/async-vault/src/epoch.rs:45-151`; `contracts/async-vault/src/lib.rs:1098` |
| A5 | The custodian can be set to the vault itself | Medium | False positive | A custodian change is checked when proposed and again when applied, and both refuse the vault's own address with `InvalidCustodian`. | `contracts/async-vault/src/treasury.rs:10-74`; `contracts/async-vault/src/guards.rs:159-163` |
| A6 | Anyone can finalize a wind-down round and lock reserves | Medium | Accepted | Finalizing is open so the operator cannot stall payouts once the cash is in. It uses only free reserve, which already leaves out priced redemptions and escrow that can still be cancelled. | `contracts/async-vault/src/wind_down.rs:163-200`; `contracts/async-vault/src/treasury.rs:30-31` |
| A7 | Settlement entries can be spammed in each epoch | Medium | False positive | Only the manager seals at will; anyone else waits the minimum epoch duration, 1 to 30 days, or cannot seal if none is set. Requests need a listed holder and real escrow, entries are never looped over, and the writer pays their rent. | `contracts/async-vault/src/settlement.rs:24-74`; `contracts/async-vault/src/lib.rs:1061` |
| A8 | Shares are minted without a compliance check | Medium | False positive | The share token's `mint` runs OpenZeppelin's RWA mint, which checks the identity verifier and the compliance contract and refuses with `MintNotCompliant`. | `contracts/async-vault/src/deposit.rs:104-106`; `contracts/share-token/src/contract.rs:670-673` |
| A9 | Persistent storage grows with each request | Low | False positive | Each entry needs the holder's signature, a listing, real escrow and room under the deposit cap, one per side per epoch. Entries are never looped over, the creator pays the rent, and untouched ones archive. | `contracts/async-vault/src/state.rs:112-134`; `contracts/async-vault/src/deposit.rs:17-28` |
| A10 | The NAV pause can be lost when a key expires | Low | False positive | Instance storage is one ledger entry with one lifetime. If it archives, the whole contract stops until it is restored, and restoring brings the pause back. | `contracts/nav-oracle/src/state.rs`, `nav_paused` |
| A11 | Position storage has no bound | Low | False positive | One entry per holder, written only by that holder's own signed call, never looped over. It must outlive a single payout, since the holder takes part in every later round. | `contracts/async-vault/src/wind_down.rs:146-274` |
| A12 | Settlement amounts accept negative values | Low | False positive | Every caller passes zero or a pricing result built from stored positive amounts and a positive price; no entrypoint forwards a caller's amount. A total that would go below zero aborts with `AccountingMismatch`. | `contracts/async-vault/src/settlement.rs:76-101`; `contracts/async-vault/src/state.rs:10-14` |

## Soroban Security Portal

The [Soroban Security Portal](https://sorobansecurity.com) is a public database of
vulnerabilities found in audits of other Stellar projects, not a scanner. Of
its 954 published vulnerabilities, the 340 rated critical, high or medium were
grouped into 16 kinds, and each kind was checked against Strata.

| Kind | Example in the portal | Triage | Why | Where we checked |
| --- | --- | --- | --- | --- |
| A zero-asset redemption from a blocked holder stays stuck (P0A) | Found while checking rounding and claims | Open: [#445](https://github.com/BootNodeDev/strata-vault-kit/issues/445), low | Returning the shares needs an eligible holder, and cancelling is closed once the epoch is priced. The epoch then never reconciles, which also defeats the fix planned for #434. | `contracts/async-vault/src/redeem.rs` `claim` → `deliver`; `contracts/async-vault/src/guards.rs:356-365` |
| Missing signature check | #735 Reflector | False positive | Every entrypoint that moves funds or changes state asks the holder or the role holder to sign first. | `contracts/async-vault/src/deposit.rs:21`; `redeem.rs:17`; `lib.rs:1062` |
| Admin takeover or renounce | #746 Verseprop | False positive | `renounce_admin` always refuses, `set_role_admin` refuses, and a new admin goes through the timelock and must accept. | `contracts/async-vault/src/lib.rs:1223, 1236` |
| Unauthorized upgrade | #305 Wombat, #456 Axelar | False positive | An upgrade is a timelocked change, checked when proposed and when applied. | `contracts/async-vault/src/governance.rs:270-274` |
| Front-running or repeating initialization | #618 EquitX | False positive | Setup runs in `__constructor`, once, in the transaction that creates the contract. There is no `initialize` to front-run. | `contracts/async-vault/src/lib.rs:144`; `contracts/nav-oracle/src/lib.rs:392` |
| Expired or archived storage | #1018 Peridot | False positive | Every read and write goes through `strata-storage`, which extends the entry's lifetime. | `crates/strata-storage/src/lib.rs` |
| Instance storage that grows without limit | #834 HiYield | False positive | The only list in instance storage is the timelock queue, which refuses new entries once 16 wait. | `crates/strata-timelock/src/queue.rs:12, 41` |
| Loops that grow until they fail | #1029 Peridot, #559 GrantPicks | False positive | Epochs keep running totals, not lists of requests, so pricing and settlement never loop over holders. | `contracts/async-vault/src/epoch.rs`; `settlement.rs` |
| Rounding and precision | #778 OctoLend | False positive | Both directions round down, so the vault never pays more than it holds; the dust is tracked. | `contracts/async-vault/src/pricing.rs:23, 33` |
| Decimals mismatch between asset and shares | #484 Untangled, #841 HiYield | False positive | Setup requires the asset and the share token to have the same decimals. | `contracts/async-vault/src/governance.rs:215` |
| Arithmetic overflow | #494, #676 | False positive | The release build has `overflow-checks = true`, and pricing uses checked math that fails with `AmountTooLarge`. | `Cargo.toml:11`; `contracts/async-vault/src/pricing.rs:24` |
| Missing value read as zero | #773 OctoLend | False positive | A default of zero is used only for running totals that start at zero; a missing contract address aborts with `NotInitialized`. | `contracts/async-vault/src/state.rs:72, 142, 152, 172, 180` |
| Stale or manipulated price | #1025, #1038 Peridot | False positive | The vault prices only when the oracle reports a valid state, and the oracle enforces expiry, the band, the maximum move and the cooldown. The known gap is #435. | `contracts/async-vault/src/epoch.rs:33-36`; `contracts/nav-oracle/src/guards.rs:142-150` |
| Failing call to another contract | #1022 Peridot | False positive | Calls to the oracle and the verifier use the `try_` form and turn a failure into a named error or a safe default (the holder treated as delisted). | `contracts/async-vault/src/pricing.rs:48`; `epoch.rs:33`; `lock_policy.rs:27` |
| Share price inflation by donation | #801 Alula, #486, #1036 | False positive | The share price comes from the oracle, not the vault's balance. A donation can only use up the deposit cap. | `contracts/async-vault/src/pricing.rs:42-55` |
| Claiming twice | #920 Matrixdock, #1019 Peridot | False positive | Each request is marked claimed when paid and refused afterwards. | `contracts/async-vault/src/deposit.rs:95`; `redeem.rs:88`; `wind_down.rs:239` |
| Fee-on-transfer token | #944 SODAX, #1030 Peridot | Accepted | The deposit asset is assumed to be a Stellar Asset Contract, which charges no fee on transfer. Nothing checks it on chain, so an operator must not configure a token with fees. | `contracts/async-vault/src/deposit.rs:55` |

Slippage and sandwich attacks (Strata has no AMM) and off-chain event handling
(Strata has no backend) do not apply.

## Certora Sunbeam

Formal verification: each rule is checked for every input, and each rule that
asserts something has a companion check that its path can be reached. The rules
and the jobs are not committed; each line gives the job id.

| Rule | Contract | Result | Triage | Job |
| --- | --- | --- | --- | --- |
| A deposit gets the exact rounded-down share amount | vault | Proven | No finding | `deposit_shares_is_exact_floor` · 3060a11a · 27b09142 |
| A redemption pays the exact rounded-down asset amount | vault | Proven | No finding | `redeem_assets_is_exact_floor` · 3060a11a |
| A deposit then a redemption never returns more than went in | vault | Proven | No finding | `pricing_round_trip_never_gains` · 3060a11a |
| A new price moves by no more than the maximum | oracle | Proven | No finding | `deviation_guard_enforces_cap` · b3c20188 |
| A new price sits inside the band | oracle | Proven | No finding | `band_guard_enforces_band` · c4b67354 |
| Only a valid oracle config is accepted | oracle | Proven | No finding | `config_guard_admits_only_valid` · e9b55faa |
| A new report waits for the cooldown | oracle | Proven | No finding | `cooldown_guard_enforces_wait` · 439001d7 · 6ca705ec |
| A zero-share deposit refund can be blocked by cash dust | vault | Violated | Open: [#434](https://github.com/BootNodeDev/strata-vault-kit/issues/434) | `issue434_core_refund_covered` · a8adccfa · 2fe243c2 |
| A stale report inside its cooldown, with a valid fresh one refused | oracle | Reachable | Open: [#435](https://github.com/BootNodeDev/strata-vault-kit/issues/435) | `stale_in_cooldown_state_reachable` · 08800b56 |
| Epoch fulfil, end-of-epoch cleanup, full deposit and claim flows | vault | No result | Not decided | 5f779e40 · 9f195846 · 64042512 · 77518228 |
| Free reserve is never negative | vault | No result | Not decided | `free_reserve_never_negative` · 9c0cd8f7 |
| A full `attest`: pause, expiry, signer, stored report | oracle | No result | Not decided | `attest_can_succeed` · e4f92083 |
| Share token: supply, mint and burn roles, timelock | share token | No result | Not decided | 96fbf222 · 5b0cb834 · 874d8237 · dbfa52ac |

"No result" is not a pass. The prover loses fields of a struct it writes to
storage and reads back, so rules that store and re-read state are out of its
reach. Flows over whole entrypoints timed out after 50 to 90 minutes, and on the
share token the prover reverts the token's call to the compliance contract.

## Remediation plan

Every critical, high and medium finding from Scout and Almanax is closed. What
stays open is the three bugs the sweep found or confirmed, and two
recommendations. Each open bug is fixed before the audit starts.

| Item | Severity | Fix | Who | Tracked in | By |
| --- | --- | --- | --- | --- | --- |
| A zero-share deposit refund blocked by cash dust | Medium | Release the dust so the refund pays, in the same change as the next row | Strata team (BootNode) | [#434](https://github.com/BootNodeDev/strata-vault-kit/issues/434) | Before the audit starts |
| A zero-asset redemption from a delisted holder stays stuck (P0A) | Low | Let the request settle when the holder cannot receive its shares, for example by burning them as a wind-down claim does, so the epoch reconciles | Strata team (BootNode) | [#445](https://github.com/BootNodeDev/strata-vault-kit/issues/445) | With #434 |
| A stale report cannot be replaced inside its cooldown | Medium | Let a fresh report replace an expired one before the cooldown ends | Strata team (BootNode) | [#435](https://github.com/BootNodeDev/strata-vault-kit/issues/435) | Before the audit starts |
| Who picks the pricing report (A4) | Medium (Almanax), accepted | Run a keeper that fulfils each epoch as soon as its notice ends | The operator of each deployment | [O13](./THREAT_MODEL.md#o13-choosing-which-report-prices-an-epoch); [STRIDE Tamper.3.R.2](./STRIDE-threat-model.md#what-are-we-going-to-do-about-it) | Before going live |
| Rules Certora could not decide | Not decided | Rerun with a verification-only mock of the compliance call, and once the prover reads stored structs back | Strata team (BootNode) | [STRIDE IP.7](./STRIDE-threat-model.md#investigation-points) | No date |

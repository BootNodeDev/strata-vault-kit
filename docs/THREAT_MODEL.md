# Threat model

What can go wrong in a Strata vault, what stops it, what is left, and the test
that shows each control. It covers the oracle, the roles and the redemption
paths. Tranche 3's threat-to-test matrix builds on it.

## Scope

- **Contracts.** `async-vault`, `share-token` and `nav-oracle`, the testnet
  stubs `identity-verifier` and `compliance`, and the shared crates
  `strata-timelock`, `strata-bindings` and `strata-storage`, at commit
  `f3c03f8`.
- **The console**, as far as signing goes: the `/sign` page that collects an
  authority's signatures (R12).
- **Not the testnet deployment.** The deployment listed in the
  [README](../README.md) runs an older release, and several controls below are
  not on it yet.

The design doc
([§8.9](./strata-product-and-architecture.md#89-trust-boundaries--failure-modes)),
the [kit spec](./kit-spec.md), the
[authorization matrix](./AUTHORIZATION_MATRIX.md), the
[compliance matrix](./COMPLIANCE_MATRIX.md) and the `//! # Design` notes at the
top of each contract's `lib.rs` describe many of these controls in more detail.
Where a document and the code disagree, this document follows the code.

## How to read it

Each threat has an id: O for the oracle, R for the roles, X for the redemption
paths. Under it:

- **Control:** what stops it, and where.
- **Residual:** what is left when the control works.
- **Tests:** the tests that show the control, or "none" and why.

Vault tests live in `contracts/async-vault/src/test/` and are cited by file name
alone, such as `cancel.rs`. Other Rust tests are cited by their path under
`contracts/` or `crates/`. `cargo test` from the repository root runs them all;
[TESTING.md](./TESTING.md) gives the environment variable `cargo` needs and the
builds the `upgrade_wasm` tests need. Harness tests, cited by title, run against
a local network ([scripts/harness/README.md](../scripts/harness/README.md)).
Console tests, also cited by title, run with `npm run test`.

## Assets

- **Investor cash.** Deposit escrow that can still be cancelled
  (`cancellable_escrow`), the reserve, cash owed to priced exits (`committed`),
  and what wind-down rounds have credited but holders have not collected
  (`wind_down_owed`).
- **Shares.** In wallets, escrowed in the vault by a redemption, and priced for
  a deposit but not yet minted (`pending_mint_shares`).
- **The share price.** The oracle's latest report.
- **Capital at the custodian** (`net_deployed`). Off chain once sent.
- **Privileged powers.** Upgrades, role grants, the custodian slot, contract
  swaps, pauses, freezes, legal transfers and the wind-down.

## Actors

| Actor | What it can do on chain |
| --- | --- |
| Governance | Admin of the vault. By deploy, also admin of the share token, the oracle and the compliance contract. |
| Guardian | Pauses the vault (vault `guardian`). By deploy, also pauses the NAV (oracle `guardian`). |
| Manager | Seals the open epoch with `close_epoch` (vault `manager`); "sealed" below means closed this way. A role, not one of the five authorities. |
| Treasury | Sends free reserve to the custodian (vault `treasury`). |
| Attester | Posts the share price (oracle `attester`). |
| Compliance | Freezes holders, and with governance makes legal transfers and recoveries (share token `compliance`). By deploy, also lists and delists addresses (identity verifier admin). |
| The vault contract | Mints, burns and moves escrowed shares (share token `manager`, which `finish_setup` requires it to hold alone). |
| Anyone | Prices a sealed epoch, funds the vault, activates a wind-down once it is due, finalizes a round. Each holder signs their own requests, cancellations and claims. |
| Outside the kit | The custodian, the deposit asset's issuer, external compliance or identity contracts, wallets, and whoever hosts a frontend. |

"By deploy" means the deploy script sets it and no contract checks it (R5). The
design calls for each of the five authorities to be a native Stellar multisig
account; no contract can check that (R4).

## Assumptions

- The Soroban host checks each `require_auth` against the account's signers and
  thresholds. It refuses to re-enter a contract already in the call stack, so a
  token or compliance hook cannot call back into the vault during a claim.
- Ledger time comes from network consensus. The cooldown, expiry, notice and
  timelock windows all read it.
- The deposit asset is a Stellar Asset Contract, such as USDC. Its issuer's
  controls are outside the kit (X10).
- OpenZeppelin's Stellar libraries, at the versions pinned in `Cargo.toml`,
  behave as documented.

## Oracle

### O1. One false report within the limits

The attester, compromised or careless, posts a price that passes every check.

- **Control:** Only an `attester` can post. A report must sit in the band
  `[min_answer, max_answer]`, move from the last report by no more than
  `max_up_bps` up or `max_down_bps` down (both required, 1 to 10,000 basis
  points), and come at least `cooldown_secs` after it. The oracle stamps the
  acceptance time itself. The vault prices an epoch only after its notice, and
  only from a report accepted at or after the epoch was sealed. The guardian or
  the oracle admin can pause the NAV at once, and revoking the attester is
  instant.
- **Residual:** A report inside the limits is taken as true. Every request in an
  epoch priced from it gets that price, so value moves between the holders who
  enter or leave then and the holders who stay. Nothing on chain compares the
  price with its evidence (O10).
- **Tests:** "cannot attest a price" in
  [`scripts/harness/guards.test.ts`](../scripts/harness/guards.test.ts);
  `attest_rejects_out_of_band` (only the floor and zero, through `attest`),
  `attest_enforces_cooldown_and_deviation` and
  `a_configured_downside_still_bounds_a_fall` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `nav_in_band_refuses_a_value_outside_the_band` (both ends of the band) in
  [`nav-oracle/src/test_guards.rs`](../contracts/nav-oracle/src/test_guards.rs);
  `an_epoch_is_not_priced_against_a_valuation_older_than_its_close` in
  [`oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs);
  `an_epoch_cannot_be_priced_inside_its_notice` in
  [`notice.rs`](../contracts/async-vault/src/test/notice.rs).

### O2. A walk of reports

A compromised attester moves the price in many steps, each inside the caps.

- **Control:** The cooldown limits how often a report lands, the caps limit
  each step, and the band limits the price. A NAV pause stops the walk, and
  revoking the attester is instant.
- **Residual:** The price can move by one cap per cooldown, and the steps
  compound. With the shortest cooldown, one second, a report can land in every
  ledger. The band is the only absolute limit. Nothing on chain raises an
  alarm; alerts on large moves belong to the
  [monitoring plan](./MONITORING_PLAN.md#v5-a-run-of-reports-one-way).
- **Tests:** `two_reports_in_one_ledger_are_refused_at_the_shortest_cooldown`
  and `attest_enforces_cooldown_and_deviation` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs).

### O3. A real move larger than a cap

The asset really loses, or gains, more than one report may show.

- **Control:** Governance chooses the caps. A fall cap of 10,000 basis points
  lets a loss of any size land in one report. With a lower cap, the oracle admin
  can pause the NAV, which stops pricing, and call `clear_latest`, so the next
  report can land anywhere in the band (O8). After setup, changing a cap waits
  for the timelock, tightening included.
- **Residual:** With a fall cap below 10,000, a large loss lands over several
  reports. Holders who leave meanwhile are paid above value, at the cost of
  those who stay, unless someone pauses the NAV. A capped rise does the same in
  reverse for those who enter. With a fall cap of 10,000, one false report can
  drop the price to `min_answer`.
- **Tests:** `a_full_downside_cap_lets_a_large_loss_land_at_once`,
  `a_full_downside_cap_leaves_min_answer_as_the_only_floor` and
  `a_configured_downside_still_bounds_a_fall` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `a_tighter_cap_or_band_waits_after_setup` in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs).

### O4. The feed goes stale

The attester stops reporting, or the last report expires.

- **Control:** A report expires at the earlier of its own `expires_at` and its
  acceptance plus `freshness_duration`. A stale feed makes `fulfill_epoch`
  fail, and requests in a sealed epoch can be cancelled again. A stale feed
  also makes `request_deposit` refuse (`FeedNotValid`), so no new deposit waits
  on it. Priced claims still pay: no claim reads the oracle. Governance revokes
  the attester at once. `health()` reports `feed_valid`, and
  `freshness_covers_notice` is false when the freshness window is shorter than
  the notice.
- **Residual:** Holders with shares cannot exit until a report lands, or until
  a wind-down pays them pro rata (X8). After setup, granting a new attester
  waits for the timelock: at least seven days, plus any time the vault spends
  paused.
- **Tests:** `heartbeat_expiry_makes_it_stale` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `fulfill_is_rejected_once_the_feed_goes_stale` in
  [`oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs);
  `a_sealed_epoch_cancels_once_the_feed_goes_stale` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `a_deposit_is_refused_while_the_feed_is_stale` and
  `a_deposit_is_refused_before_the_first_report` in
  [`deposit.rs`](../contracts/async-vault/src/test/deposit.rs);
  `a_notice_longer_than_a_report_lives_is_reported` in
  [`health.rs`](../contracts/async-vault/src/test/health.rs).

### O5. Time games

The attester gives a report a far expiry, or prices a sealed epoch with a
valuation made before the seal.

- **Control:** The oracle stores the earlier of the given expiry and acceptance
  plus `freshness_duration` (at most 35 days), and refuses an expiry that has
  already passed. The attester gives no time of its own: the oracle records the
  ledger time it accepted the report, and the vault compares that time with the
  seal.
- **Residual:** The chain knows when a report was accepted, not when its
  valuation was made. A report accepted after the seal can carry a valuation
  made before it.
- **Tests:** `a_reporter_expiry_past_the_window_is_cut_to_the_window` and
  `attested_at_is_when_the_contract_took_the_report` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `expires_in_future_refuses_a_report_born_stale` in
  [`nav-oracle/src/test_guards.rs`](../contracts/nav-oracle/src/test_guards.rs);
  `an_attestation_before_the_close_does_not` in
  [`timing.rs`](../contracts/async-vault/src/test/timing.rs).

### O6. Declining a price after seeing it

A holder learns the price of a sealed epoch and cancels if it does not suit
them.

- **Control:** Once a sealed epoch's price is readable, cancellation closes,
  even while the notice runs. A price is readable when the feed holds a valid
  report accepted at or after the seal and the vault is not paused.
  Cancellation opens again only when that stops being true: the report expires
  or falls out of the band, the NAV or the vault is paused, the report is
  cleared, or an oracle swap leaves no such report. A wind-down opens it too.
  Apart from activating a wind-down that is already due, no holder can cause
  any of these. Anyone can price the epoch once its notice ends.
- **Residual:** Whoever knows the price before the report lands, such as the
  attester or anyone the valuation reaches early, can cancel first. If the
  report that closed the window expires before anyone prices the epoch,
  cancellation opens again; keep `freshness_duration` longer than the notice. A
  guardian can reopen cancellation by pausing the vault, and only governance
  lifts that pause. An epoch takes the latest valid report at the moment someone
  prices it, so a later report can replace the one that closed the window.
- **Tests:** `a_sealed_epoch_cannot_be_cancelled_while_it_can_be_priced`,
  `cancellation_reopens_when_the_price_that_closed_it_expires` and
  `a_paused_vault_reopens_cancellation_of_an_epoch_it_could_price` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `the_notice_does_not_reopen_the_cancellation_window` in
  [`notice.rs`](../contracts/async-vault/src/test/notice.rs);
  `anyone_may_fulfill_a_closed_epoch` in
  [`epochs.rs`](../contracts/async-vault/src/test/epochs.rs).

### O7. The NAV pause used to stall pricing

A compromised guardian pauses the NAV, again and again.

- **Control:** The NAV pause stops only new reports, pricing and new deposits.
  Redemption requests, claims and cancellations go on, and sealed epochs can be
  cancelled again.
  Only the oracle admin lifts it (`set_nav_paused(false)`), and revoking the
  oracle's guardian is instant.
- **Residual:** Pricing waits until governance lifts the pause. Revoking the
  guardian stops further pauses but does not lift this one. The oracle's
  guardian is the vault's guardian by deploy only.
- **Tests:** `pausing_the_nav_is_limited_to_the_guardian` and
  `the_guardian_pauses_the_nav_but_unpausing_needs_governance` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `revoking_an_attester_or_a_guardian_stays_instant_after_setup` in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs);
  `fulfill_is_rejected_while_the_nav_is_paused` in
  [`oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs);
  `a_sealed_epoch_cancels_while_the_nav_is_paused` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `a_deposit_is_refused_while_the_nav_is_paused` in
  [`deposit.rs`](../contracts/async-vault/src/test/deposit.rs).

### O8. Clearing the stored report

`clear_latest` removes the last report, so the next one has no earlier price to
cap it.

- **Control:** Only the oracle admin clears, and only while the NAV is paused,
  so lifting the pause and posting the next report are separate acts. The
  oracle publishes `LatestCleared`. The band still bounds the next report.
- **Residual:** The first report after a clear can land anywhere in the band,
  and so can the first report after deployment. Pausing the NAV, clearing and
  lifting the pause are all instant, also after setup, so the oracle admin and
  an attester acting together can set any price in the band at once. Alerts on
  `LatestCleared` and on the report after it belong to the
  [monitoring plan](./MONITORING_PLAN.md#v6-the-stored-report-is-cleared).
- **Tests:** `the_record_clears_only_while_the_nav_is_paused` and
  `only_admin_can_clear_latest` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `the_nav_pause_and_clearing_stay_instant_after_setup` in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs).

### O9. Governance changes the limits or the feed

Governance loosens the caps or the band, or points the vault at a feed it
controls.

- **Control:** After setup, every change to the oracle's config except a
  shorter `freshness_duration` waits for the vault's timelock (R1), and its
  bounds are checked again when it applies. A shorter freshness window stays
  instant: later reports expire sooner, and no value moves. Swapping the vault's
  oracle is a timelocked change too. The new feed must name this vault, have
  finished its setup and answer `state()` and `freshness_duration()`, both when
  the swap is proposed and when it applies. No config sets a floor below
  `MIN_ANSWER`.
- **Residual:** The feed checks catch wiring mistakes, not intent: a contract
  governance writes can answer them and report any price. The delay is notice,
  not a guaranteed exit (R1). An epoch sealed before the swap is priced by
  whichever feed stands when it is priced.
- **Tests:** `a_tighter_cap_or_band_waits_after_setup`,
  `a_shorter_freshness_window_stays_instant_after_setup` and
  `a_config_outside_the_bounds_is_refused_when_it_applies` in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs);
  `a_floor_below_a_millionth_of_an_asset_unit_per_share_is_refused` and
  `a_stored_floor_below_the_minimum_stays_until_a_config_change_raises_it` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `the_oracle_changes_only_through_the_timelock`,
  `a_feed_outside_this_vault_is_never_proposed`,
  `a_feed_that_stops_naming_this_vault_is_never_installed`,
  `a_contract_that_is_not_a_feed_is_refused_when_proposed_and_when_applied`
  and `a_sealed_epoch_is_priced_by_the_feed_standing_at_fulfilment` in
  [`oracle_swap.rs`](../contracts/async-vault/src/test/oracle_swap.rs);
  "governance cannot loosen the feed config at once" in
  [`scripts/harness/guards.test.ts`](../scripts/harness/guards.test.ts).

### O10. The proof proves nothing on chain

A report's evidence is missing, wrong, or has nothing to do with the price.

- **Control:** Each report carries a proof hash, which must not be all zeros,
  and an optional URI of at most 256 bytes. The oracle stores both with the
  report, returns them from `latest()` and publishes them in `NavAttested`.
- **Residual:** The oracle never checks the hash against a document. Any
  non-zero hash passes, and the URI may stop working. A reader fetches the
  evidence and compares the hash off chain.
- **Tests:** `a_report_without_a_proof_hash_is_refused`,
  `a_proof_uri_past_the_limit_is_refused`,
  `the_latest_report_carries_its_proof`,
  `attesting_publishes_the_stored_valuation` and
  `a_proof_uri_at_the_limit_is_stored_and_published` (both check that
  `NavAttested` carries the proof) in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs).

### O11. An oracle upgraded in place cannot read its old report

Releases before the proof reference stored the report in another shape. An
oracle upgraded in place from one of them cannot read it, so every read of the
report fails, and pricing stops. Cancelling a request in a sealed epoch fails
too while the vault is unpaused and not winding down, because the vault then
asks the feed's state first. A cancellation in the open epoch, in a paused
vault or during a wind-down still works: the vault does not ask the feed then.

- **Control:** The recovery in the
  [kit spec](./kit-spec.md#upgrading-the-oracle-from-an-earlier-release): pause
  the NAV before the upgrade applies, apply it, call `clear_latest`, lift the
  pause, and attest. While the NAV is paused, `state()` answers `Paused` without
  reading the report, and neither `pause_nav` nor `clear_latest` reads it. After
  setup the upgrade itself waits for the timelock.
- **Residual:** If the upgrade lands before the NAV pause, pricing and those
  cancellations fail until the NAV is paused. Deposits are refused while the
  NAV is paused (`FeedNotValid`) or the feed cannot answer, so the vault takes
  none from the upgrade or the pause until the first report after the clear.
  That report has no earlier price to cap it (O8). A fresh deployment has no
  old report.
- **Tests:** `a_report_of_the_earlier_shape_is_cleared_and_replaced` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs).

### O12. An integrator reads a price the vault would refuse

A contract that reads the share price takes `nav_per_share()` or `latest()`
without checking the feed's state.

- **Control:** `state()` answers `Valid`, `Stale` or `Paused`, and
  `ensure_consumable()` fails unless the feed is valid. `latest()` returns the
  report's `accepted_at` and `expires_at`. The vault checks `state()` before it
  prices.
- **Residual:** `nav_per_share()` and `latest()` return the stored report even
  when it is stale, out of band or paused. An integrator who skips `state()`
  reads a price the vault would refuse. The SEP-40 adapter is not built yet.
- **Tests:** `the_nav_pause_holds_regardless_of_freshness` and
  `heartbeat_expiry_makes_it_stale` in
  [`nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs);
  `a_paused_feed_is_refused_by_the_vault_not_the_oracle` in
  [`oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs).

## Roles

### R1. Governance compromised: the changes that wait

Someone takes governance's keys and changes code, roles or wiring.

- **Control:** After each contract's setup, these changes wait in a public queue
  (`propose_change`, then `apply_change`) on the vault's clock:
  - vault: an upgrade, the upgrade delay, a role grant, revoking `manager`, an
    admin hand-over, the custodian, a lower notice or wind-down delay, the
    oracle;
  - share token: an upgrade, a role grant (a second minter included), revoking
    `manager`, an admin hand-over, a compliance or verifier swap;
  - oracle: an upgrade, a role grant, an admin hand-over, a config change other
    than a shorter freshness window;
  - the kit's compliance contract: adding or removing a module, binding or
    unbinding a token, an admin hand-over.

  The delay is 7 to 90 days, and never shorter than the notice when the change
  applies. Time the vault spends paused does not count, nothing applies while it
  is paused, nothing but a grant of the token's `compliance` role is proposed or
  applied during a wind-down, and no admin hand-over is accepted then. One code
  change waits at a time. No contract offers an immediate upgrade. Renouncing
  the admin and setting a role admin are always refused. Every proposal is
  published (`ChangeProposed`) and listed by `pending_changes()`.
- **Residual:** The delay is notice, not a guaranteed exit: leaving needs a
  sealed epoch, a valid price accepted after the seal, and cash. Once the delay
  runs, an upgrade can do anything, and a vault upgrade can also change the
  clock the other three contracts read. A second `manager` on the token could
  mint shares and redeem them against the reserve;
  `health().sole_token_manager` turns false only when the grant lands. Revoking
  the vault's `manager` role on the token, or unbinding the token from the
  compliance contract, stops every request, claim and cancellation that mints,
  burns or moves shares. During a wind-down, governance can still grant
  `compliance` to an account it controls after one published delay, then sign
  `legal_transfer` or `recover_balance` with it alone. Holders who are not
  frozen can surrender their shares to `claim_wind_down` meanwhile, once a
  round is finalised.
- **Tests:** `grants_and_manager_revokes_wait_for_the_timelock`,
  `a_change_shorter_than_a_raised_notice_never_lands`,
  `nothing_timelocked_moves_during_a_wind_down_a_manager_revoke_included` and
  `an_admin_hand_over_cannot_be_accepted_during_a_wind_down` in
  [`governance.rs`](../contracts/async-vault/src/test/governance.rs);
  `applying_before_the_eta_is_refused`, `applying_while_paused_is_refused`,
  `a_pause_freezes_the_upgrade_timelock_clock`,
  `a_second_code_change_while_one_stands_is_refused`,
  `the_vault_exposes_no_immediate_upgrade`,
  `the_vault_reports_its_clock_to_the_token_and_the_oracle` and, with
  `--features upgrade_wasm`, `the_token_exposes_no_immediate_upgrade` in
  [`upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs);
  `governance_cannot_renounce_itself_out_of_the_vault` in
  [`controls.rs`](../contracts/async-vault/src/test/controls.rs);
  `grants_and_manager_revokes_wait_after_setup`,
  `rule_and_verifier_swaps_wait_after_setup` and
  `an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` in
  [`share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs);
  `grants_wait_after_setup_and_land_through_the_timelock`,
  `an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` and, with
  `upgrade_wasm`, `the_oracle_exposes_no_immediate_upgrade` in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs);
  `after_setup_rule_changes_wait_for_the_timelock` and
  `an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` in
  [`compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs);
  `time_spent_paused_does_not_count_toward_the_delay` in
  [`strata-timelock/src/test/schedule.rs`](../crates/strata-timelock/src/test/schedule.rs);
  `a_delay_from_seven_to_ninety_days_is_in_bounds` in
  [`strata-timelock/src/test/delay.rs`](../crates/strata-timelock/src/test/delay.rs).

### R2. Governance compromised: the powers that act at once

Someone takes governance's keys and uses the powers that need no delay.

- **Control:** The instant powers either move no value by themselves or are
  emergency tools:
  - unpause the vault, lift a NAV pause, call `clear_latest` while the NAV is
    paused, pause or unpause the share token's transfers;
  - set the deposit cap, up or down; raise the notice (up to 30 days, and never
    above the upgrade delay) or the wind-down delay; shorten the oracle's
    freshness window;
  - revoke the vault's treasury or guardian, the oracle's attester or guardian,
    or the token's compliance role;
  - propose or cancel a queued change; propose a wind-down, which waits its own
    delay of 7 to 90 days and which governance may cancel until then;
  - co-sign a legal transfer or a recovery (`recover_balance`) with compliance
    (R10).
- **Residual:** With an attester, governance can set any price in the band at
  once (O8). With compliance, it can move any holder's wallet shares at once
  (R10). A raised notice delays pricing for every epoch sealed afterwards, and
  holds back queued changes with a shorter delay. A token pause stops trading
  between holders, though not entries or exits.
- **Tests:** `the_deposit_cap_stays_instant_both_ways`,
  `raising_the_notice_is_instant_and_lowering_waits` and
  `revoking_treasury_or_guardian_stays_instant` in
  [`governance.rs`](../contracts/async-vault/src/test/governance.rs);
  `the_nav_pause_and_clearing_stay_instant_after_setup` and
  `revoking_an_attester_or_a_guardian_stays_instant_after_setup` in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs);
  `revoking_compliance_stays_instant_after_setup` in
  [`share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs);
  `governance_cancels_a_proposal_before_activation` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs).

### R3. Setup left open, or wired wrong

A deployment takes deposits while admin changes are still instant, or with a
binding missing.

- **Control:** The vault, the share token, the oracle and the compliance
  contract each start in a setup window in which admin changes are instant.
  `finish_setup` closes it once, and it never reopens. The vault refuses
  deposits, redemptions, and sealing or pricing an epoch until its own setup
  is finished (`SetupOpen`). Its `finish_setup` refuses (`SetupIncomplete`)
  unless:
  - the token and the oracle name this vault and have finished their own setup;
  - the vault is the token's only `manager`, and no shares exist yet;
  - the vault passes the identity check and is not frozen on the token;
  - the token is in its compliance contract's `linked_tokens`, and a compliance
    contract that answers both `VaultBinding` views names this vault with its
    setup finished (one that leaves either view unanswered is accepted as
    external);
  - the asset and the token have the same decimals, and the asset, the token,
    the oracle and the vault are four different addresses;
  - the oracle answers `state()` and `freshness_duration()`, and a custodian
    other than the vault is set;
  - the vault's own books are empty: the first epoch, with no deposit or
    redemption booked in it, nothing committed, and no shares owed or to burn.

  It also refuses while an admin hand-over offered during setup is still open.
  `health()` reports each of these checks except three: that no shares exist
  yet, that the vault's own books are empty, and that no hand-over is pending.
- **Residual:** Before `finish_setup`, the admin changes anything at once. The
  checks read only the token's `manager` list: a second attester, treasury or
  guardian is not checked, though each contract shows its role holders. An
  external compliance contract keeps its own governance. A vault built with the
  `short_wind_down` feature, meant for local tests and marked so in its contract
  meta, activates a wind-down with no delay, and nothing on chain refuses that
  build.
- **Tests:** `a_deposit_before_setup_finishes_is_refused`,
  `a_redemption_before_setup_finishes_is_refused`,
  `no_epoch_is_sealed_or_priced_before_setup_finishes`,
  `a_redemption_planted_during_setup_never_reaches_a_depositor`,
  `setup_finishes_after_cash_is_funded_during_it`,
  `every_wiring_step_is_checked_before_setup_finishes`,
  `a_compliance_contract_from_outside_the_kit_is_accepted`,
  `setup_cannot_finish_while_a_hand_over_is_pending` and
  `setup_never_finishes_twice` in
  [`setup.rs`](../contracts/async-vault/src/test/setup.rs);
  `each_missing_wiring_step_shows_in_its_own_flag` in
  [`health.rs`](../contracts/async-vault/src/test/health.rs);
  `the_setup_window_closes_once` in
  [`strata-timelock/src/test/setup.rs`](../crates/strata-timelock/src/test/setup.rs).

### R4. An authority's keys

An authority is a single key, its keys collude, or a call takes more signatures
than it shows.

- **Control:** Each privileged call asks each account it needs for exactly one
  signature, on that call only; `legal_transfer` and `recover_balance` ask
  compliance and the token admin once each. The network checks each account's
  signers and thresholds. The design calls for each authority to be a native
  Stellar multisig account.
- **Residual:** No contract can check that an authority is a multisig, or how
  many keys it needs: that is set at deploy. Keys that reach an authority's
  threshold act for it. No test reads each authority's signers and thresholds
  on the network yet; that comes with the multisig authorities, which are
  planned. No test submits a privileged call through a relayer that pays the fee
  while the authority signs only its authorization. None is planned: the kit
  runs no relayer or backend, and whoever sends a transaction pays its fee.
- **Tests:** `each_setup_call_asks_the_admin_for_one_signature` (the setters,
  a grant, a revoke, a hand-over offer and its cancellation, `finish_setup`),
  `each_admin_call_after_setup_asks_the_admin_for_one_signature` (the change
  queue, `unpause`, a wind-down proposal and its cancellation, accepting a
  hand-over) and `each_role_call_asks_its_holder_for_one_signature`
  (`close_epoch`, `deploy_to_custodian`, `pause`, `renounce_role`) in
  [`signatures.rs`](../contracts/async-vault/src/test/signatures.rs);
  `each_role_call_asks_its_holder_for_one_signature` (mint, burn, forced
  transfer, the freezes, `renounce_role`) and
  `a_legal_transfer_or_a_recovery_asks_each_signer_once` in
  [`share-token/src/test.rs`](../contracts/share-token/src/test.rs);
  `each_admin_call_asks_the_admin_for_one_signature` (setup, the change queue,
  roles, the transfer pause, both swaps) in
  [`share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs);
  `each_admin_call_asks_the_admin_for_one_signature` (setup, the change queue,
  roles, `set_config`, the NAV pause, `clear_latest`) and
  `each_role_call_asks_its_holder_for_one_signature` (`attest`, `pause_nav`,
  `renounce_role`, accepting a hand-over) in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs);
  `each_admin_call_asks_the_admin_for_one_signature` (setup, bindings, modules,
  the change queue) in
  [`compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs);
  `each_admin_call_asks_the_admin_for_one_signature` (`allow` and
  `set_claim_topics_and_issuers`) in
  [`identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs).
  Signers and thresholds on the network: none yet.

### R5. One account in several seats

One key holds several roles, within a contract or across contracts, so one
compromise reaches several powers.

- **Control:** The vault's constructor refuses four pairs of equal addresses:
  treasury and guardian, treasury and governance, compliance and governance,
  compliance and treasury. It compares nothing else, and it is the only check
  on who holds which role. Separately, the share token refuses a legal
  transfer or a recovery signed by one account in both seats, compliance and
  admin (R10); that check does not stop the grant itself.
- **Residual:** Nothing checks later grants or hand-overs: governance can grant
  itself the vault's treasury role, at once during setup or through the
  timelock after it. Separation is not enforced across contracts either: the
  oracle's, the token's and the verifier's roles are constructor parameters,
  equal to the vault's authorities by deploy only. Governance may also be the
  guardian, and the manager may be anyone. Every check compares addresses, and
  two Stellar accounts can share a signer, so distinct addresses do not prove
  distinct keys. The checks are being redesigned so that a deployment may
  choose to run every role from one key, which the four refusals forbid today
  at construction. Until then, holders read each contract's role holders; the
  verifier stub has no view of its admin.
- **Tests:** `the_treasury_may_not_also_be_the_guardian`,
  `the_treasury_may_not_also_be_governance`,
  `compliance_may_not_also_be_governance`,
  `compliance_may_not_also_be_the_treasury` and
  `the_guardian_may_be_governance` in
  [`constructor.rs`](../contracts/async-vault/src/test/constructor.rs);
  `one_account_cannot_co_sign_with_itself` (the grant of `compliance` to the
  admin goes through; the call it then signs alone is refused) in
  [`share-token/src/test.rs`](../contracts/share-token/src/test.rs). Later
  grants and other contracts: none, because nothing checks them.

### R6. Guardian compromised

The guardian pauses the vault or the NAV to stall it.

- **Control:** The guardian can pause the vault and pause the NAV, and nothing
  else. A vault pause stops deposit requests, pricing and applying queued
  changes, and stops the timelock's clock. Redemption requests, claims,
  cancellations, deployments to the custodian, funding and the wind-down go on.
  Only governance unpauses, and it revokes the guardian at once.
- **Residual:** A pause delays pricing and every queued change, fixes included,
  until governance acts, and the paused time is added to every queued change's
  wait. While the vault is paused, sealed epochs can be cancelled again.
- **Tests:** `only_the_guardian_pauses`,
  `the_guardian_pauses_but_only_governance_unpauses`,
  `a_paused_vault_still_takes_redeem_requests`,
  `a_paused_vault_still_pays_redemptions` and
  `a_paused_vault_does_not_fulfill_epochs` in
  [`controls.rs`](../contracts/async-vault/src/test/controls.rs);
  `the_pause_never_blocks_a_cancellation` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `the_pause_does_not_block_a_wind_down_claim` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs);
  `revoking_treasury_or_guardian_stays_instant` in
  [`governance.rs`](../contracts/async-vault/src/test/governance.rs);
  `a_pause_freezes_the_upgrade_timelock_clock` in
  [`upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs).

### R7. Treasury compromised

The treasury drains the reserve.

- **Control:** `deploy_to_custodian` moves at most the free reserve: what the
  vault holds, less cancellable escrow, `committed` and `wind_down_owed`. It
  sends only to the stored custodian, and never during a wind-down. While
  anything is uncovered, the free reserve is zero. After setup the custodian
  changes only through the timelock, and never to the vault itself.
- **Residual:** The treasury can send the whole free reserve to the custodian at
  any time; exits priced later wait until the cash comes back through `fund`.
  What the custodian does with the money is off chain.
- **Tests:** `assets_owed_to_a_priced_redemption_cannot_be_deployed` and
  `deploying_needs_the_treasury_role` in
  [`treasury.rs`](../contracts/async-vault/src/test/treasury.rs);
  `refundable_escrow_is_not_free_reserve` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `the_treasury_cannot_deploy_while_anything_is_uncovered` in
  [`multi_epoch.rs`](../contracts/async-vault/src/test/multi_epoch.rs);
  `the_custodian_changes_through_the_timelock` and
  `a_custodian_change_to_the_vault_is_refused_when_proposed_and_when_applied` in
  [`governance.rs`](../contracts/async-vault/src/test/governance.rs);
  `an_active_wind_down_sends_nothing_to_the_custodian` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs).

### R8. The manager stops sealing, or picks the moment

The manager stops sealing, so nothing is priced, or seals when it suits someone.

- **Control:** The manager can only seal the open epoch. It cannot set the
  price: anyone prices a sealed epoch from the oracle. Requests in the open
  epoch can be cancelled at any time, apart from the holds in X3 and X4.
- **Residual:** The manager decides which requests share a price. A manager who
  stops sealing blocks every exit at a price; holders can still cancel, getting
  a deposit back as cash and a redemption back as shares. After setup, replacing
  the manager waits for the timelock, at least seven days.
  [#335](https://github.com/BootNodeDev/strata-vault-kit/issues/335) plans to
  let anyone seal an epoch that has been open for a minimum time.
- **Tests:** `a_non_manager_cannot_close` and
  `anyone_may_fulfill_a_closed_epoch` in
  [`epochs.rs`](../contracts/async-vault/src/test/epochs.rs);
  `cancelling_a_deposit_returns_the_asset` and
  `cancelling_a_redemption_returns_the_shares` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `grants_and_manager_revokes_wait_for_the_timelock` in
  [`governance.rs`](../contracts/async-vault/src/test/governance.rs).

### R9. Compliance compromised

Compliance freezes or delists holders wrongly, or lists an address it should
not.

- **Control:** Freezes need the token's `compliance` role; they act at once and
  are published. The vault's own address cannot be frozen once the token knows
  its vault. Compliance cannot mint, burn, use `forced_transfer` or swap the
  token's rules or verifier, and it moves a holder's shares only with
  governance's signature in the same call (R10). Governance revokes the token's
  `compliance` role at once. The token's last `compliance` holder cannot
  renounce (`LastComplianceHolder`). A grant of `compliance` goes through the
  token's timelock even during a wind-down, after the normal delay. The deploy
  grants a cold backup holder during setup. A delisted holder still leaves in
  cash (X4), and what a frozen holder is owed stays recorded (X3).
- **Residual:** A wrongful freeze holds all of a holder's exits, covered claims
  included, until it is lifted; nothing on chain checks for a legal order. A
  frozen holder's exits, a wind-down claim included, wait for a live
  `compliance` holder. If governance revokes the last one or its key is lost, a
  freeze stays until a grant lands one delay later; with no backup and no
  governance action, it stays for good. The testnet verifier stub's admin, the
  compliance key by deploy, lists and delists at once, without an event, and
  can be replaced only by swapping the verifier, which waits for the timelock
  after setup. The verifier and compliance contracts in this repository are
  testnet stubs;
  [#238](https://github.com/BootNodeDev/strata-vault-kit/issues/238) chooses
  what replaces them on mainnet.
- **Tests:** `the_vault_address_cannot_be_frozen`,
  `compliance_alone_cannot_move_shares`, `compliance_no_longer_forces_transfers`,
  `the_compliance_authority_cannot_mint_burn_or_swap_the_rules` and
  `the_last_compliance_holder_cannot_renounce` in
  [`share-token/src/test.rs`](../contracts/share-token/src/test.rs);
  `revoking_compliance_stays_instant_after_setup`,
  `governance_still_revokes_the_last_compliance_holder_at_once`,
  `a_compliance_grant_lands_through_the_timelock_during_a_wind_down`,
  `a_compliance_grant_proposed_before_the_wind_down_lands_during_it` and
  `a_paused_vault_still_holds_a_compliance_grant_in_a_wind_down` in
  [`share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs);
  `a_frozen_holder_is_paid_once_a_compliance_holder_granted_in_the_wind_down_lifts_the_freeze`
  in [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs);
  `only_admin_can_allow` in
  [`identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs);
  "governance and the vault manager cannot freeze a holder" in
  [`scripts/harness/guards.test.ts`](../scripts/harness/guards.test.ts).

### R10. Compliance and governance move a holder's shares together

The two authorities, colluding or both compromised, take a holder's shares.

- **Control:** `legal_transfer` needs the `compliance` role and the token
  admin's signature in the same call, from two different accounts. It never
  moves shares out of or into the vault's address, so it cannot reach escrow,
  priced cash, unminted shares or a wind-down credit. The destination must pass
  the identity check. Each transfer publishes `LegalTransfer` with an order
  reference of 1 to 128 bytes.
- **Residual:** Together the two can move any amount of any holder's wallet
  shares at once, with no delay, frozen shares included. With the testnet
  verifier stub, compliance itself lists the destination. Nothing on chain
  checks that a legal order exists. `recover_balance` needs the same two
  signatures and a recovery account named by the verifier; the testnet stub
  names none, so recovery always fails there.
- **Tests:** `compliance_and_the_admin_move_shares_together`,
  `one_account_cannot_co_sign_with_itself`, `nothing_leaves_the_vault_address`,
  `nothing_lands_on_the_vault_address`,
  `the_destination_must_pass_the_identity_check`,
  `the_order_reference_is_required_and_bounded` and
  `recovery_needs_the_admin_too` in
  [`share-token/src/test.rs`](../contracts/share-token/src/test.rs).

### R11. Swapping the token's compliance contract or verifier

Governance installs rules or a verifier that block exits, let anyone in, or
change without notice.

- **Control:** After setup a swap waits for the vault's timelock. It is checked
  when proposed and again when applied. New rules must list the token in
  `linked_tokens`. If they answer both of the kit's `VaultBinding` views,
  `vault()` and `setup_open()`, they must name this vault with their setup
  finished. A compliance contract that leaves either view unanswered is
  accepted as external, as `finish_setup` accepts one. A new verifier must
  accept the vault's address.
- **Residual:** The checks catch wiring mistakes, not intent. An external
  compliance contract keeps its own governance: its module changes do not wait
  for the vault's timelock. The binding views prove nothing either: rules that
  name another vault, or whose setup is open, pass as soon as they stop
  answering one view, even between proposal and apply. A new verifier can
  refuse every holder, which stops deposits but leaves exits in cash, or accept
  anyone.
- **Tests:** `rules_off_this_vaults_clock_or_without_the_token_are_never_proposed`,
  `rules_that_stop_qualifying_are_never_installed`,
  `rules_from_outside_the_kit_are_installed_while_they_list_the_token`,
  `rules_that_stop_answering_a_binding_view_are_installed_as_external`,
  `a_verifier_that_refuses_the_vault_or_cannot_answer_is_never_proposed` and
  `a_verifier_that_stops_accepting_the_vault_is_never_installed` in
  [`share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs);
  `an_unbound_compliance_swap_is_refused_and_every_move_goes_on` in
  [`compliance.rs`](../contracts/async-vault/src/test/compliance.rs); "refuses
  an instant verifier swap, even from governance" in
  [`scripts/harness/guards.test.ts`](../scripts/harness/guards.test.ts).

### R12. A crafted transaction on the console's signing page

An authority opens a shared `/sign` link, sees one operation and signs another.

- **Control:** The page decodes the transaction before anyone signs. It refuses
  a fee-bump envelope, more than one operation, an operation that is not a
  contract call, an operation whose source differs from the transaction's, an
  authorization entry that is not the source account's, and a transaction not
  yet valid. It also refuses a contract other than the configured vault,
  oracle, share token and identity verifier, an operation the console does not
  offer, and arguments of the wrong shape. It shows the operation in the
  console's terms.
- **Residual:** A signer may sign in the wallet without reading it. A tampered
  or impersonated console can show anything; each operator hosts its own. The
  console builds no `legal_transfer`, so a co-signed order is built outside it.
  At this commit the console is built against the contracts deployed on
  testnet, an older release; some of its operations, such as a compliance
  `forced_transfer`, no longer exist in these contracts.
- **Tests:** "refuses a fee bump envelope", "refuses a transaction with more
  than one operation", "refuses a host function that is not a contract
  invocation", "refuses an operation with a source other than the
  transaction's", "refuses an auth entry with address credentials" and
  "refuses a transaction that is not valid yet" in
  [`app-lib/multisig.test.ts`](../app-lib/multisig.test.ts); "refuses a contract
  that is not one of the configured four", "refuses an operation the console
  does not propose" and "refuses arguments of the wrong shape" in
  [`app/src/pages/sign.test.ts`](../app/src/pages/sign.test.ts).

## Redemption paths

### X1. The reserve cannot pay a priced exit

Priced exits owe more cash than the vault holds.

- **Control:** Pricing fixes the cash owed (`committed`) whether or not the cash
  is there. A claim pays when the liquid reserve (what the vault holds, less
  cancellable escrow) covers that claim's own amount; otherwise it fails with
  `ClaimNotCovered` and stays owed. Claims pay in any order, so a covered claim
  never waits behind a larger one. While anything is uncovered, nothing goes to
  the custodian. `uncovered()` shows the gap, and anyone can `fund` the vault.
- **Residual:** An exit waits for the treasury or the custodian, with no
  deadline. Being uncovered is not insolvency; whether the vault's assets cover
  its liabilities is for the attested price and governance.
- **Tests:** `a_claim_waits_until_the_reserve_covers_it`,
  `a_covered_claim_pays_while_a_larger_one_waits` and
  `the_treasury_cannot_deploy_while_anything_is_uncovered` in
  [`multi_epoch.rs`](../contracts/async-vault/src/test/multi_epoch.rs);
  `the_epoch_prices_but_the_claim_waits_for_the_cash` in
  [`redeem.rs`](../contracts/async-vault/src/test/redeem.rs); "the large claim
  waits" and "pays once the capital returns" in
  [`scripts/harness/guards.test.ts`](../scripts/harness/guards.test.ts).

### X2. A pause, a stale feed or a delisting blocks a covered claim

An administrative act stops a holder from collecting a priced, covered exit.

- **Control:** `claim_redeem` has no pause check and does not read the oracle.
  It asks the verifier about the holder but pays a delisted holder like a listed
  one, and a verifier that fails to answer counts as delisted. Of the holder's
  own standing, only a freeze holds the claim (X3).
- **Residual:** The claim still needs the liquid reserve to cover it, or it
  fails with `ClaimNotCovered` (X1). It also calls the share token, to check
  the freeze and burn the escrow, and the token calls the compliance contract.
  A module that fails there blocks it (X6), and so would a timelocked revoke of
  the vault's `manager` role on the token or an unbinding of the token from its
  compliance contract (R1).
- **Tests:** `a_paused_vault_still_pays_redemptions` in
  [`controls.rs`](../contracts/async-vault/src/test/controls.rs);
  `a_delisted_holder_can_still_claim_their_exit` in
  [`compliance.rs`](../contracts/async-vault/src/test/compliance.rs);
  `a_priced_claim_still_pays_during_a_wind_down` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs), which pays
  a week after the price, when the test feed's one-hour report has long
  expired. A claim while the NAV is paused: none; the claim code (`claim` in
  [`contracts/async-vault/src/redeem.rs`](../contracts/async-vault/src/redeem.rs))
  never calls the oracle.

### X3. A frozen holder

A freeze is used to take or redirect a holder's value.

- **Control:** The vault refuses a frozen holder's requests, claims and
  cancellations with `Frozen`. What it owes them stays recorded, and no other
  holder can claim that record: escrowed cash, priced but unminted shares,
  escrowed shares, priced cash in `committed`, and a wind-down credit in
  `wind_down_owed`. A partial freeze limits a redemption or a wind-down claim to
  the free shares. Lifting the freeze releases everything. A legal transfer
  reaches only wallet shares (R10).
- **Residual:** A freeze holds even a covered claim, for as long as it lasts.
  Lifting a freeze needs a live `compliance` holder (R9). The record is safe,
  but the cash behind it is pooled: while the reserve is short, other covered
  claims pay first (X1), and after a loss of reserve in a wind-down, claims can
  spend each other's cash (X8). The vault cannot pay an authority directly. A
  refund for a deposit worth less than one share at its price is not tracked as
  owed: it waits in the free reserve, where the treasury can deploy it or a
  wind-down round can credit it to others. Counsel must confirm the hold for
  each jurisdiction.
- **Tests:** `a_frozen_holder_is_paid_only_after_the_freeze_lifts`,
  `a_frozen_investors_escrow_stays_until_the_freeze_lifts`,
  `a_frozen_investor_is_not_minted_until_unfrozen`,
  `a_partial_freeze_limits_an_exit_to_the_free_shares` and
  `a_frozen_investors_zero_share_refund_is_held` in
  [`compliance.rs`](../contracts/async-vault/src/test/compliance.rs);
  `a_frozen_holders_slice_stays_owed_until_the_freeze_lifts` and
  `a_partial_freeze_keeps_frozen_shares_out_of_a_wind_down_claim` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs).

### X4. A delisted holder

Delisting traps a holder in shares they may no longer hold, or an unlisted
address gets in.

- **Control:** The vault checks the allowlist when a deposit is requested,
  before any cash moves. A delisted holder who is not frozen can request a
  redemption, claim cash and cancel a deposit. When they claim a priced deposit,
  the vault mints the shares into its own escrow and adds them to their
  redemption in the open epoch, paid in cash at that epoch's price; in a
  wind-down they join the holder's entitlement. They cannot cancel a redemption
  back into shares.
- **Residual:** They leave at a later epoch's price, and a fall since their
  deposit was priced is theirs. The conversion mints into the vault's own
  escrow, so it waits while compliance has delisted the vault;
  `health().allowlisted` then reads false, and nothing is lost. A redemption
  priced at zero assets cannot give its shares back to a delisted holder, so
  its request stays open. Only the holder can start an exit: nothing lets
  compliance or governance redeem a holder who is no longer eligible. If a
  fund's terms require that, it needs a new power, and counsel must confirm the
  process.
- **Tests:** `an_investor_who_was_never_allowlisted_is_refused_before_any_cash_moves`,
  `a_delisted_holder_can_still_queue_an_exit` and
  `a_delisted_holder_cannot_cancel_redemption_back_to_shares` in
  [`compliance.rs`](../contracts/async-vault/src/test/compliance.rs);
  `a_delisted_holders_priced_deposit_joins_their_redemption_in_the_open_epoch`
  and `a_conversion_waits_while_the_vault_is_delisted` in
  [`delisted.rs`](../contracts/async-vault/src/test/delisted.rs);
  `a_delisted_holder_with_a_worthless_exit_keeps_the_request` in
  [`share_returns.rs`](../contracts/async-vault/src/test/share_returns.rs).

### X5. Escrowed shares that should come back

A token pause, the vault's own delisting or the rules stop a cancelled
redemption from returning.

- **Control:** Outside a wind-down, `cancel_redeem` checks the holder itself
  (not frozen, passes the identity check, allowed by the rules' `can_transfer`)
  and returns the shares with the manager's `forced_transfer`. Neither the token
  pause nor the vault's own place on the allowlist applies to that move.
- **Residual:** A return the rules refuse fails with `HolderNotEligible`; the
  request stays and is paid in cash once priced. In a wind-down no shares come
  back: the escrow is burned into the holder's entitlement.
- **Tests:** `a_token_pause_stops_trading_but_not_a_share_return`,
  `a_delisted_vault_still_returns_escrowed_shares`,
  `a_return_the_compliance_rules_refuse_stays_escrowed` and
  `a_partial_freeze_does_not_stop_a_return` in
  [`share_returns.rs`](../contracts/async-vault/src/test/share_returns.rs);
  `an_escrowed_redemption_cancelled_in_a_wind_down_joins_the_payout` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs).

### X6. A compliance module blocks exits

A module on the compliance contract refuses or fails, so the token's calls fail.

- **Control:** On the kit's compliance contract, modules change only through the
  vault's timelock after setup, never while the vault is paused, and never
  during a wind-down. The kit registers no modules.
- **Residual:** The token calls the compliance contract on every mint, transfer
  and burn, and exits use all three: a mint for a share claim, a forced transfer
  to escrow or return a redemption, a burn to pay a redemption or a wind-down
  claim. A module that refuses or fails there blocks even a covered exit.
  Removing it waits for the timelock, and during a wind-down it cannot be
  removed at all. An external compliance contract changes its modules under its
  own governance. Which modules mainnet uses, and what they may do during an
  exit, is decided with
  [#238](https://github.com/BootNodeDev/strata-vault-kit/issues/238).
- **Tests:** `a_compliance_module_that_refuses_the_mint_blocks_a_priced_claim`
  in [`compliance.rs`](../contracts/async-vault/src/test/compliance.rs);
  `a_module_failing_on_burn_blocks_wind_down_claims_and_cannot_be_removed` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs);
  `a_refused_mint_keeps_a_priced_deposit_epoch_open` in
  [`settlement.rs`](../contracts/async-vault/src/test/settlement.rs);
  `after_setup_rule_changes_wait_for_the_timelock` and
  `nothing_lands_while_the_vault_is_paused_or_winding_down` in
  [`compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs).

### X7. Escrow behind stalled pricing

A stale feed, a stopped manager or a pause keeps escrowed cash or shares from
coming back.

- **Control:** Cancelling is one atomic step that returns the whole escrow. It
  is open while the epoch is open. For a sealed epoch it stays open until a
  valid report accepted at or after the seal can be read with the vault
  unpaused, even during the notice (O6). It opens again if that report expires
  or falls out of the band, if the NAV or the vault is paused, or if the report
  is cleared or an oracle swap leaves none. It stays open throughout a
  wind-down.
- **Residual:** Between a readable report and the end of the notice, a request
  can be neither cancelled nor priced; the notice is at most 30 days. A frozen
  holder cannot cancel (X3). A delisted holder's redemption does not come back
  as shares; it is paid in cash (X4). Nobody exits at a price until pricing
  resumes.
- **Tests:** `a_sealed_epoch_is_still_cancellable`,
  `a_sealed_epoch_cancels_once_the_feed_goes_stale`,
  `a_sealed_epoch_cancels_while_the_nav_is_paused` and
  `the_pause_never_blocks_a_cancellation` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `the_notice_does_not_reopen_the_cancellation_window` in
  [`notice.rs`](../contracts/async-vault/src/test/notice.rs);
  `an_epoch_sealed_before_the_announcement_is_still_cancellable` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs); "the deposit
  can now be cancelled and the asset returns" in
  [`scripts/harness/guards.test.ts`](../scripts/harness/guards.test.ts).

### X8. Wind-down

A wind-down is used to trap holders, is stalled, or pays some holders at
others' cost.

- **Control:** Governance proposes it. Once its delay of 7 to 90 days has run,
  anyone can activate it; until then governance may cancel it. From the
  proposal on, the vault takes no new deposit. Once active, it cannot be
  undone. It takes no new requests, prices nothing and sends nothing to the
  custodian, while priced claims, cancellations and funding go on. Anyone
  finalizes a round. Each round credits only the free reserve, pro rata to a
  supply snapshot taken at the first round, and every payment rounds in the
  vault's favour. The snapshot counts holders' shares only: the share token
  refuses a transfer into the vault.
- **Residual:**
  - It pays out only what is on chain. The vault cannot make the custodian
    return capital.
  - A holder who never claims is never paid. Rounding leaves less than one unit
    per holder in `wind_down_owed` at any price the oracle allows, plus the
    value of any shares the snapshot counted that were never minted.
  - No queued change applies during a wind-down except a grant of the token's
    `compliance` role, so nothing else can be fixed then, a failing module
    included (X6).
  - `uncovered()` leaves out what the rounds owe, although `free_reserve()`
    subtracts it. After a loss of reserve, such as an issuer clawback (X10),
    `uncovered()` can read zero while the vault cannot pay both its priced exits
    and its round credits. A claim of either kind can then take cash owed to the
    other, and a wind-down claim, which checks no coverage at all, can also take
    deposit escrow. This stays a stated limit (Known limits, item 5): the vault
    does not decide who bears a loss of reserve (X10), and funding the gap
    lifts it.
  - Shares sent to a vault before its token was upgraded stay in the snapshot,
    and no one can claim their slice.
- **Tests:** `only_governance_proposes`, `activation_is_open_to_a_stranger`,
  `governance_cancels_a_proposal_before_activation`,
  `an_active_wind_down_cannot_be_cancelled`, `anyone_may_finalise_a_round`,
  `a_round_leaves_priced_liabilities_alone`,
  `the_payouts_never_exceed_what_the_rounds_credited`,
  `after_every_holder_claims_owed_keeps_at_most_one_unit_per_holder`,
  `a_round_of_one_unit_at_the_lowest_price_still_credits_it`,
  `at_the_lowest_price_holders_collect_the_reserve_less_a_unit_each`,
  `the_claimable_view_and_the_claim_fail_alike_at_the_overflow_edge` and
  `the_claimable_view_shows_what_the_claim_then_pays` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs);
  `wind_down_delay_elapsed_refuses_before_the_activation_time` (the guard
  `activate_wind_down` runs) in
  [`guards.rs`](../contracts/async-vault/src/test/guards.rs). For
  `uncovered()` with round credits, none: the limit is stated, not built.

### X9. Rounding and amounts below one share

Rounding lets a claim take more than its share, or a tiny deposit is lost.

- **Control:** Conversions round down, in the vault's favour. Claims round one
  by one, so together they never pay more than pricing promised. When an
  epoch's last request settles, the remainder leaves `committed` and
  `pending_mint_shares` and stays in the reserve (`EpochReconciled`). A running
  total that would go below zero fails (`AccountingMismatch`) instead of being
  clamped. A deposit worth less than one share mints nothing and is refunded at
  claim, from the free reserve.
- **Residual:** Rounding remainders stay with the fund. A request that never
  settles keeps its epoch's remainder in the totals. The refund for a deposit
  below one share is not set aside when the epoch is priced: the treasury or a
  wind-down round can spend that cash first, and the claim then waits for the
  free reserve.
- **Tests:** `deposit_and_redeem_round_trip_never_manufactures_assets` and
  `conversion_rounds_down_in_the_vaults_favour` in
  [`conversions.rs`](../contracts/async-vault/src/test/conversions.rs);
  `the_last_redemption_claim_clears_the_cash_remainder_and_says_so_once` and
  `a_total_that_would_go_below_zero_fails_loudly` in
  [`settlement.rs`](../contracts/async-vault/src/test/settlement.rs);
  `a_deposit_below_one_share_is_refunded_at_claim` and
  `a_refund_after_pricing_leaves_the_priced_total_unchanged` in
  [`deposit.rs`](../contracts/async-vault/src/test/deposit.rs);
  `a_dust_refund_never_takes_committed_money` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs);
  `a_zero_share_refund_is_refused_once_a_round_has_taken_the_reserve` in
  [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs).

### X10. The deposit asset's issuer freezes or claws back the vault's cash

The issuer of the deposit asset freezes the vault's balance or takes it back.

- **Control:** The kit cannot stop the issuer; it is a declared risk of the
  chosen asset. A payout goes only to the holder's own address. After a
  clawback, the vault pays in this order and refuses the rest by name:
  1. Escrow a depositor can still cancel. `cancel_deposit` pays when the
     vault's balance covers that deposit's own amount; otherwise
     `EscrowNotCovered`. While the balance is below the total cancellable
     escrow, `request_deposit` refuses with `EscrowNotCovered`, so a new
     deposit never pays an earlier cancellation.
  2. Priced redemptions. `claim_redeem` pays when the liquid reserve (the
     balance less cancellable escrow) covers its own amount; otherwise
     `ClaimNotCovered`, and the claim stays owed in `committed`.
  3. What wind-down rounds owe sits beside priced redemptions in the free
     reserve.
  4. Last, and only from the free reserve: a refund of a deposit below one
     share (`claim_deposit`, `ClaimNotCovered`) and a transfer to the custodian
     (`deploy_to_custodian`, `ReserveCommittedToExits`).

  `uncovered()` shows the gap, `committed + cancellable_escrow - balance` when
  positive. Once the treasury funds it with `fund`, the refusals for
  cancellations, priced claims and new deposits lift. A refund of a deposit
  below one share and a transfer to the custodian also need free reserve, which
  `uncovered()` does not show.
- **Residual:**
  - Within each class, whoever acts first is paid first. The vault does not
    decide who finally bears the loss.
  - Pricing does not read the balance. An epoch priced during the gap mints its
    deposits in full, and the loss reaches holders through the NAV.
  - A freeze leaves the vault's balance readable, so the vault's checks pass
    and the transfer fails inside the asset with the asset's own error. Every
    cash exit waits until the freeze lifts.
  - No deploy script reads the asset's authorization flags yet, although the
    design doc's §8.10 says a deployment checks and reports them.
  - In a wind-down, `uncovered()` understates the gap, and a wind-down claim
    checks no coverage before it transfers (X8). It can take deposit escrow, or
    fail inside the asset with the asset's own error when the balance is short.
- **Tests:** `a_cancellation_the_balance_cannot_cover_is_refused_by_name`,
  `cancellations_are_paid_in_the_order_they_come_while_the_balance_lasts`,
  `no_deposit_is_taken_while_the_balance_is_below_the_escrow`,
  `a_priced_redemption_waits_while_the_issuer_has_taken_the_escrow`,
  `a_refund_below_one_share_waits_while_the_issuer_has_taken_the_escrow`,
  `nothing_goes_to_the_custodian_while_the_issuer_has_taken_the_escrow` and
  `pricing_ignores_a_shortfall_and_mints_the_full_deposit` in
  [`clawback.rs`](../contracts/async-vault/src/test/clawback.rs);
  `a_claim_waits_until_the_reserve_covers_it` in
  [`multi_epoch.rs`](../contracts/async-vault/src/test/multi_epoch.rs). None
  freezes the vault's balance.

### X11. Storage that expires

An idle contract's instance, code or entries archive, so calls fail.

- **Control:** Each contract extends its instance and the kit's own entries on
  the calls kit spec §5 lists: on the vault, every call that reads or writes
  them; on the token, every call that moves shares or changes a setting.
  OpenZeppelin extends an entry when it reads it, and the kit reads back each
  entry it creates through OpenZeppelin, so a new entry gets its full lifetime
  in the transaction that creates it. Role entries are the exception: after a
  grant, a role check extends only that account's role entry, and a revoke
  rewrites the member list without extending it.
  `npm run extend -w scripts/harness` restores and extends each instance, its
  Wasm and each pending change. A call can restore archived entries itself once
  simulation adds the restore
  ([kit spec §5](./kit-spec.md#5-storage-lifetime-ttl-policy)).
- **Residual:** An entry nobody touches archives 30 days after its last renewal
  (90 for a role), and on mainnet no sooner than 120 days after it was created.
  The next call that needs it pays the restore, and restoring many entries can
  take separate transactions. A production compliance module or identity
  registry must extend its own entries the same way, or the share token stops
  working when they archive.
- **Tests:** `any_vault_read_restores_the_instance_ttl` and
  `a_pending_request_still_claims_after_most_of_a_month` in
  [`ttl.rs`](../contracts/async-vault/src/test/ttl.rs);
  `reading_a_decayed_entry_restores_the_full_ttl` in
  [`strata-storage/src/test.rs`](../crates/strata-storage/src/test.rs).

### X12. Resource limits, contention and griefing

Many requests in one epoch, or someone who wants to get in the way, push calls
past a transaction's limits, make them compete for the same entries, or keep
others out.

- **Control:** Pricing and wind-down rounds read only running totals, so their
  cost does not grow with the number of requests, and each holder mints, burns
  or is paid in their own call
  ([design doc §8.4](./strata-product-and-architecture.md#84-request-lifecycle)).
  No call walks over holders or requests. A holder has at most one deposit and
  one redemption request per epoch. Whoever sends a request pays its fee and
  the storage for its entry. Deposits need an allowlisted address, and
  redemptions need shares.
- **Residual:** Requests, cancellations and claims write entries that all
  holders share: the running totals in the vault's instance, each epoch's
  record and settlement record, and the vault's own asset and share balances.
  Calls in the same ledger compete for those entries, and nothing has measured
  how many fit in one ledger. Anyone holding the asset can call `fund` with one
  unit, and an allowlisted investor can request and cancel a deposit again and
  again, paying only fees. An allowlisted investor can also fill the deposit
  cap with a deposit and cancel it before pricing, keeping others out of that
  epoch. Governance can raise the cap at once, and compliance can delist the
  investor.
- **Tests:** none yet for cost or contention; a measurement is planned.
  `cancellation_frees_capacity` in
  [`deposit_cap.rs`](../contracts/async-vault/src/test/deposit_cap.rs) shows a
  deposit holding the whole cap and its cancellation freeing it;
  `the_same_investor_can_request_again_after_cancelling` in
  [`cancel.rs`](../contracts/async-vault/src/test/cancel.rs).

### X13. An upgrade cannot read what the vault stored

An upgrade changes the shape of a stored type, so the new code cannot read
entries the old code wrote: requests, settlement records, wind-down positions,
or queued changes.

- **Control:** After setup, upgrades wait for the timelock (R1). The vault, the
  share token and the oracle each keep a `schema_version`. The kit spec says
  this release is deployed fresh rather than upgraded in place over an earlier
  vault, because its settlement record cannot count requests made before it
  existed
  ([kit spec, Invariant 7](./kit-spec.md#invariant-7-directional-rounding--non-creation-of-value)).
  The oracle's own case has a written recovery (O11).
- **Residual:** No release ships a `migrate`; only test builds have one. If an
  upgrade changes a stored struct's fields or a variant's payload, every entry
  of the old shape fails to decode. Read from the code, not from a test, that
  would mean: claims and cancellations on old requests revert, and so do
  `pending_changes()`, applying a queued change of the old shape, and proposing
  a code change while any change of the old shape is queued (an upgrade, or on
  the vault also an upgrade-delay change). Cancelling such a change still
  works, since cancelling does not read it. Recovery needs a migration written
  for that release.
- **Tests:** `applying_a_wasm_change_replaces_the_code` and
  `a_migration_refuses_a_second_run` (a stand-in contract with a test-only
  `migrate`), and `the_token_upgrades_under_live_balances_and_open_requests`
  (a token upgrade that keeps the storage shape, under live balances and open
  requests), all with `--features upgrade_wasm`, in
  [`upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs);
  `the_oracle_upgrades_under_a_live_valuation`, also with `upgrade_wasm`, in
  [`nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs).
  A vault upgrade over stored entries of another shape: none, because no
  release changes a stored type yet. The failures above are read from the
  code, and a test belongs with the first release that changes one.

## Known limits

These are decided, and stated as they stand:

1. A compliance module that refuses can block a covered exit, and removing it
   waits for the timelock (X6). Which modules mainnet uses is decided in
   [#238](https://github.com/BootNodeDev/strata-vault-kit/issues/238).
2. A manager who stops sealing blocks every exit at a price; holders can still
   cancel (R8). [#335](https://github.com/BootNodeDev/strata-vault-kit/issues/335)
   plans sealing by anyone after a minimum epoch length.
3. The identity verifier and compliance contracts in this repository are
   testnet stubs, not for mainnet (R9, R11).
4. The vault's constructor is the only check on who holds which role, for four
   pairs; later grants and the other contracts' roles are not checked (R5). The
   share token does refuse a legal transfer or recovery signed by one account
   as both compliance and admin (R10). The checks are being redesigned so that
   a deployment may choose to run every role from one key, which the
   constructor's four refusals forbid today at construction.
5. `uncovered()` leaves out what a wind-down owes, although `free_reserve()`
   subtracts it, and a wind-down claim checks no coverage, so after a loss of
   reserve it can spend deposit escrow (X8, X10).
6. No test signs through a relayer: the kit runs none, and whoever sends a
   transaction pays its fee (R4).
7. The testnet deployment in the README runs older code than this commit
   ([Scope](#scope)).
8. A clawback of the vault's cash by the asset's issuer is a loss of the fund
   that the vault does not assign. While it lasts, the vault refuses by name
   what its balance cannot cover: `EscrowNotCovered` for cancellations and new
   deposits, `ClaimNotCovered` for claims (X10).

## What has no test yet

For Tranche 3's matrix:

- A covered claim while the NAV is paused (X2).
- Each authority's signers and thresholds, read on the network (R4).
- A privileged call sent through a relayer: dropped, since the kit runs no
  relayer (R4).
- Role separation after construction and across contracts, which nothing
  checks yet (R5).
- `uncovered()` with wind-down credits (X8).
- The deposit asset's issuer freezing the vault's balance, and a deploy check
  of the asset's authorization flags (X10).
- The cost of a call, and contention between calls in one ledger (X12).
- A vault upgrade over requests, positions or queued changes stored in an
  earlier shape (X13).
- Alerts on large price moves, on `LatestCleared` and on the report after it
  (O2, O8), which belong to the [monitoring plan](./MONITORING_PLAN.md).

## Out of scope

The quality of the KYC behind the allowlist; the data and method behind each
valuation; the custodian's operations and solvency; the deposit asset's issuer
beyond X10; how the authorities keep and rotate their keys; who hosts a
frontend, and how; external compliance and identity contracts beyond the checks
in R11; OpenZeppelin's libraries and the Stellar network itself.

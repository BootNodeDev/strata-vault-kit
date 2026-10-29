# Testing

Where the tests are that cover storage, TTL and host behaviour. Every contract
test runs against the in-memory Soroban `Env`, so the host's storage, auth,
ledger and event rules are the real ones, not mocks.

## Running them

```sh
SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 nix develop -c cargo test
```

The variable is needed whenever `cargo` runs directly (see
[AGENTS.md](../AGENTS.md)). The tests that upgrade the vault, the share token
and the oracle to a real WASM build run only with `--features upgrade_wasm`,
after five builds: the fixture in
[`fixtures/upgrade-target`](../fixtures/upgrade-target), the share token, the
oracle, and a probe build of the token and of the oracle, each a stand-in for
its next version. Inside `nix develop`:

```sh
stellar contract build --manifest-path fixtures/upgrade-target/Cargo.toml
stellar contract build --package share-token
stellar contract build --package nav-oracle
CARGO_TARGET_DIR=target/upgrade-probe stellar contract build --package share-token --features upgrade_probe
CARGO_TARGET_DIR=target/upgrade-probe stellar contract build --package nav-oracle --features upgrade_probe
SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 cargo test -p async-vault -p nav-oracle --features upgrade_wasm with_wasm
```

The `short_wind_down` feature builds a vault whose wind-down minimum is zero,
for a local harness only; its WASM carries the meta entry `build = short
wind-down; local tests only`. Check that it compiles with
`cargo check -p async-vault --features short_wind_down`. Do not run the test
suite under it: tests that subtract from the minimum assume seven days.

CI also runs three checks that fail on any finding. Run them before pushing,
inside `nix develop`:

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo deny --locked check
```

`deny.toml` lists the allowed licences and every ignored advisory with its
reason.

## Storage and TTL

The contracts read and write through the shared helpers in
[`crates/strata-storage`](../crates/strata-storage/src/lib.rs). A write extends the entry to
30 days; a read that finds the entry extends it again once it has fallen more
than a day short. The instance follows the same rule. The
[TTL policy](./kit-spec.md#5-storage-lifetime-ttl-policy) says what each
contract extends, who pays, and how to restore an archived one.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| Persistent entries round-trip and get the full TTL on write | [`crates/strata-storage/src/test.rs`](../crates/strata-storage/src/test.rs) | `persistent_round_trips`, `writing_sets_the_full_ttl` |
| A read restores a decayed entry; a missing entry is not created | [`crates/strata-storage/src/test.rs`](../crates/strata-storage/src/test.rs) | `reading_a_decayed_entry_restores_the_full_ttl`, `reading_a_missing_entry_creates_nothing` |
| Instance writes and reads extend the contract instance | [`crates/strata-storage/src/test.rs`](../crates/strata-storage/src/test.rs) | `instance_writes_bump_the_instance`, `reading_the_instance_restores_its_ttl` |
| The share token, identity verifier and compliance contract extend their own instance on every call that does work | [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs), [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs), [`contracts/identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs), [`contracts/compliance/src/test.rs`](../contracts/compliance/src/test.rs), [`contracts/compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs) | `a_transfer_restores_the_instance_ttl`, `the_vaults_mint_burn_and_escrow_restore_the_instance_ttl`, `every_admin_call_restores_the_instance_ttl`, `allowing_and_checking_restore_the_instance_ttl`, `the_hooks_a_token_calls_after_moving_shares_restore_the_instance_ttl` |
| Vault requests and epochs are written with the full TTL | [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs) | `a_request_and_its_epoch_are_written_with_the_full_ttl`, `a_redemption_request_is_written_with_the_full_ttl` |
| Reading a vault request, epoch or the instance restores its TTL | [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs) | `reading_a_decayed_request_restores_its_full_ttl`, `reading_a_decayed_epoch_restores_its_full_ttl`, `any_vault_read_restores_the_instance_ttl` |
| A request still claims, and a wind-down position still pays, after most of a month | [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `a_pending_request_still_claims_after_most_of_a_month`, `a_position_survives_the_ledger_advancing` |
| The oracle's latest valuation keeps a full TTL while it is read | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `the_latest_valuation_keeps_a_full_ttl_while_it_is_read` |
| The oracle's setup, grant, hand-over and change calls extend its instance | [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs) | `setup_grants_hand_overs_and_changes_restore_the_instance_ttl` |
| Every call that writes a share balance or a freeze gives a new one its full TTL, under testnet's minimum lifetime; so do a deposit claim and the first redemption, through the vault | [`contracts/share-token/src/test_ttl.rs`](../contracts/share-token/src/test_ttl.rs), [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs) | `a_mint_writes_the_new_balance_with_the_full_ttl`, `an_escrow_writes_the_receiving_balance_with_the_full_ttl`, `a_recovery_writes_the_new_balance_with_the_full_ttl`, `sending_nothing_from_an_empty_account_writes_its_balance_with_the_full_ttl`, `a_partial_freeze_writes_its_entry_with_the_full_ttl`, `the_first_redemption_writes_the_vaults_share_balance_with_the_full_ttl` |
| Every role grant in the vault, the token and the oracle gives the role's entries their full TTL: in the constructor, during setup and through the timelock | [`contracts/share-token/src/test_ttl.rs`](../contracts/share-token/src/test_ttl.rs), [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs), [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs) | `the_constructor_writes_each_role_with_the_full_ttl`, `a_grant_during_setup_writes_the_role_with_the_full_ttl`, `a_grant_through_the_timelock_writes_the_role_with_the_full_ttl` |
| Binding a token or adding a module gives each new compliance entry its full TTL, under testnet's minimum lifetime: during setup and through the timelock | [`contracts/compliance/src/test/ttl.rs`](../contracts/compliance/src/test/ttl.rs) | `a_binding_during_setup_writes_the_bound_tokens_with_the_full_ttl`, `a_binding_through_the_timelock_writes_the_bound_tokens_with_the_full_ttl`, `the_binding_that_opens_a_second_bucket_writes_it_with_the_full_ttl`, `a_module_added_during_setup_writes_the_hooks_modules_with_the_full_ttl`, `a_module_added_through_the_timelock_writes_the_hooks_modules_with_the_full_ttl` |
| Under mainnet's longer minimum a new entry starts at that minimum; a balance is first renewed on day 91, a role on day 31 | [`contracts/share-token/src/test_ttl.rs`](../contracts/share-token/src/test_ttl.rs) | `under_mainnets_minimum_a_new_balance_is_first_renewed_on_day_91`, `under_mainnets_minimum_a_new_role_is_first_renewed_on_day_31` |
| An epoch that was never written reads as nothing | [`contracts/async-vault/src/test/constructor.rs`](../contracts/async-vault/src/test/constructor.rs) | `unwritten_epoch_reads_as_none`, `epoch_zero_is_the_absent_id` |

The test `Env` does not archive an entry whose TTL runs out; it still reads it.
So these tests check the TTL numbers the contracts set, not what the network
does once an entry is archived.

The share token's balances and freezes, the compliance stub's modules and bound
tokens, and the roles of the vault, the token and the oracle, are stored by the
OpenZeppelin Stellar library. It extends an entry when it reads it, not when it
creates it, so the contracts read back each one they create. Without that, a
new entry would start at the network's minimum lifetime. The tests for it set
the ledger's minimum to testnet's 120,960 ledgers; the test `Env` defaults to
4,096. OpenZeppelin never extends the instance, so the token, the identity
verifier and the compliance contract extend their own on every call that does
work.

## Authorization

Authorization is tested in two separate layers.

**Who may call (roles).** Each privileged entrypoint is called by an account
that holds the role and by accounts that do not: an unrelated address, or
another authority such as governance calling a manager-only entrypoint. Role
membership is the contract's real state, not a mock. Most of these tests run
with `mock_all_auths`, so every signature is granted and a refusal can only
come from the role check.

**Which signatures a call needs.** A refusal test signs the call as another
account only (`mock_auths`), or clears all signatures with `set_auths(&[])`,
and checks the call fails and changes nothing, which proves the entrypoint
requires the right address to sign. A signature test reads `e.auths()` right
after a call and expects one entry per account the call needs, on that call
only.

The per-entrypoint role matrix, with the refusal test for each, is in
[AUTHORIZATION_MATRIX.md](./AUTHORIZATION_MATRIX.md).

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| Every privileged call asks each account it needs for one signature: an admin call asks the admin once, a role call asks the role holder once, and `legal_transfer` and `recover_balance` ask compliance and the admin once each | [`contracts/async-vault/src/test/signatures.rs`](../contracts/async-vault/src/test/signatures.rs), [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs), [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs), [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs), [`contracts/compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs), [`contracts/identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs) | `each_setup_call_asks_the_admin_for_one_signature`, `each_admin_call_after_setup_asks_the_admin_for_one_signature`, `each_admin_call_asks_the_admin_for_one_signature`, `each_role_call_asks_its_holder_for_one_signature`, `a_legal_transfer_or_a_recovery_asks_each_signer_once`, `a_hand_over_asks_each_side_for_one_signature`, `each_hook_asks_the_bound_token_for_one_signature` |
| An account other than the admin cannot pause, unpause or swap the token's rules or verifier, or unpause the vault, even when it signs | [`contracts/async-vault/src/test/controls.rs`](../contracts/async-vault/src/test/controls.rs), [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs) | `a_caller_other_than_the_admin_cannot_unpause_even_when_it_signs`, `a_caller_other_than_the_admin_is_refused_even_when_it_signs` |
| A deposit is one investor signature that covers the vault call and the asset transfer inside it | [`contracts/async-vault/src/test/deposit.rs`](../contracts/async-vault/src/test/deposit.rs) | `one_investor_signature_covers_the_request_and_the_transfer` |
| Investor calls refuse without the investor's signature | [`contracts/async-vault/src/test/deposit.rs`](../contracts/async-vault/src/test/deposit.rs), [`contracts/async-vault/src/test/redeem.rs`](../contracts/async-vault/src/test/redeem.rs) | `request_deposit_needs_the_investor_authorisation`, `claiming_needs_the_investor_authorisation`, `request_redeem_needs_the_holder_authorisation` |
| Role calls refuse without the role holder's signature | [`contracts/async-vault/src/test/epochs.rs`](../contracts/async-vault/src/test/epochs.rs), [`contracts/async-vault/src/test/notice.rs`](../contracts/async-vault/src/test/notice.rs), [`contracts/async-vault/src/test/treasury.rs`](../contracts/async-vault/src/test/treasury.rs), [`contracts/async-vault/src/test/deposit_cap.rs`](../contracts/async-vault/src/test/deposit_cap.rs) | `closing_needs_the_manager_authorisation`, `setting_the_notice_needs_governance_authorisation`, `setting_the_custodian_needs_the_admin_signature`, `unauthorized_caller_rejected` |
| Guardian, governance and upgrade powers stay with their role | [`contracts/async-vault/src/test/controls.rs`](../contracts/async-vault/src/test/controls.rs), [`contracts/async-vault/src/test/upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `the_guardian_pauses_but_only_governance_unpauses`, `only_governance_proposes_and_cancels`, `only_governance_applies`, `only_governance_sets_the_delay` |
| Roles that must stay separate are refused at deployment | [`contracts/async-vault/src/test/constructor.rs`](../contracts/async-vault/src/test/constructor.rs) | `the_treasury_may_not_also_be_the_guardian`, `compliance_may_not_also_be_governance` |
| Share token: only the right role mints, burns, pauses, freezes or moves shares | [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs) | `unauthorized_caller_cannot_mint`, `unauthorized_caller_cannot_burn`, `unauthorized_caller_cannot_forced_transfer`, `unauthorized_caller_cannot_freeze_or_recover` |
| Share token: compliance moves a holder's shares only with the admin's signature in the same call, never out of or into the vault's address, by order or by transfer, and cannot freeze the vault | [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs) | `compliance_alone_cannot_move_shares`, `one_account_cannot_co_sign_with_itself`, `nothing_leaves_the_vault_address`, `a_transfer_into_the_vault_is_refused`, `recovery_needs_the_admin_too`, `the_vault_address_cannot_be_frozen` |
| Share token: only the admin binds the vault, finishes setup and runs the timelock | [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs) | `only_the_admin_binds_and_finishes`, `only_the_admin_proposes_cancels_and_applies` |
| Oracle: only the attester posts, only the guardian pauses the NAV | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `attest_is_role_gated`, `pausing_the_nav_is_limited_to_the_guardian`, `only_admin_can_set_config` |
| Oracle: only the admin binds the vault, finishes setup, runs the timelock and revokes a role | [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs) | `only_the_admin_binds_and_finishes`, `only_the_admin_proposes_cancels_and_applies`, `only_the_admin_revokes_a_role` |
| Compliance contract: only the admin binds the vault, finishes setup, runs the timelock and offers or cancels a hand-over; only the nominee accepts it | [`contracts/compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs) | `only_the_admin_binds_and_finishes`, `only_the_admin_proposes_cancels_and_applies`, `only_the_admin_offers_or_cancels_a_hand_over`, `only_the_nominee_accepts_a_hand_over`, `an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` |
| Vault: only the admin finishes setup; after it, the custodian, grants, `manager` revokes, hand-overs and a lower notice or wind-down delay go through the timelock, while revoking the treasury or the guardian stays instant | [`contracts/async-vault/src/test/setup.rs`](../contracts/async-vault/src/test/setup.rs), [`contracts/async-vault/src/test/governance.rs`](../contracts/async-vault/src/test/governance.rs) | `only_governance_finishes_setup`, `the_custodian_changes_through_the_timelock`, `grants_and_manager_revokes_wait_for_the_timelock`, `revoking_treasury_or_guardian_stays_instant`, `only_the_admin_revokes_a_role`, `an_admin_hand_over_cannot_be_accepted_during_a_wind_down`, `cancelling_a_hand_over_stays_open_during_a_wind_down` |
| Identity verifier: only the admin edits the allowlist | [`contracts/identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs) | `only_admin_can_allow` |

## Ledger time and sequence

The vault fixture's `advance` moves the ledger timestamp and sequence together,
so time rules and TTL can be reached in one test.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| The test clock moves time and sequence | [`contracts/async-vault/src/test/controls.rs`](../contracts/async-vault/src/test/controls.rs) | `the_clock_helper_moves_time_and_sequence` |
| Closing records the ledger time; pricing waits for the notice period | [`contracts/async-vault/src/test/notice.rs`](../contracts/async-vault/src/test/notice.rs) | `closing_records_the_moment_and_the_wait`, `an_epoch_cannot_be_priced_inside_its_notice`, `it_is_priced_once_the_notice_elapses`, `an_epoch_whose_notice_would_end_past_the_clock_stays_open` |
| The manager seals at any time; anyone else once the open epoch has run the minimum epoch duration, counted from the end of setup or the last seal; the minimum stays within 1 to 30 days and, after setup, changes only through the timelock | [`contracts/async-vault/src/test/sealing.rs`](../contracts/async-vault/src/test/sealing.rs) | `an_outsider_seals_once_the_minimum_has_run`, `an_outsider_cannot_seal_before_the_minimum`, `the_manager_seals_before_the_minimum`, `a_raised_minimum_counts_from_the_epochs_start`, `an_upgraded_vault_lets_anyone_seal_a_minimum_after_it_lands` |
| A valuation must be newer than the epoch close | [`contracts/async-vault/src/test/oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs) | `an_epoch_is_not_priced_against_a_valuation_older_than_its_close`, `a_valuation_taken_in_the_closing_ledger_prices_the_epoch` |
| Oracle freshness, cooldown and its own timestamp | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `heartbeat_expiry_makes_it_stale`, `attest_enforces_cooldown_and_deviation`, `attest_stamps_its_own_timestamp`, `a_reporter_expiry_past_the_window_is_cut_to_the_window`, `two_reports_in_one_ledger_are_refused_at_the_shortest_cooldown` |
| Upgrade and wind-down timelocks follow the ledger clock | [`contracts/async-vault/src/test/upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `applying_before_the_eta_is_refused`, `a_pause_freezes_the_upgrade_timelock_clock`, `governance_proposes_and_anyone_activates_after_the_delay` |
| The share token's changes wait on the vault's clock: a vault pause moves the eta, a wind-down refuses them, except a `compliance` grant; the last `compliance` holder cannot renounce, and a frozen holder is paid once a new one lifts the freeze | [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs), [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `a_grant_lands_one_vault_delay_after_it_was_proposed`, `a_vault_pause_moves_the_eta_and_holds_the_change`, `nothing_is_proposed_or_applied_while_the_vault_winds_down`, `an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down`, `a_compliance_grant_lands_through_the_timelock_during_a_wind_down`, `a_compliance_grant_proposed_before_the_wind_down_lands_during_it`, `a_paused_vault_still_holds_a_compliance_grant_in_a_wind_down`, `governance_still_revokes_the_last_compliance_holder_at_once`, `the_last_compliance_holder_cannot_renounce`, `a_frozen_holder_is_paid_once_a_compliance_holder_granted_in_the_wind_down_lifts_the_freeze` |
| The oracle's changes wait on the vault's clock the same way | [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs) | `a_loosened_config_lands_through_the_timelock`, `a_vault_pause_moves_the_eta_and_holds_the_change`, `nothing_is_proposed_or_applied_while_the_vault_winds_down`, `an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` |
| So do the compliance contract's module, token-binding and admin changes, once its setup is finished | [`contracts/compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs) | `after_setup_rule_changes_wait_for_the_timelock`, `a_proposed_binding_lands_after_the_delay`, `a_vault_pause_pushes_the_change_back`, `nothing_lands_while_the_vault_is_paused_or_winding_down`, `an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` |
| The vault's own changes wait on its clock: a raised notice blocks a shorter change, a pause holds one, a wind-down refuses them, and a wind-down waits at least seven days | [`contracts/async-vault/src/test/governance.rs`](../contracts/async-vault/src/test/governance.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `a_change_shorter_than_a_raised_notice_never_lands`, `a_pending_role_change_lands_after_a_pause`, `nothing_timelocked_moves_during_a_wind_down_a_manager_revoke_included`, `an_unset_delay_still_waits_the_minimum`, `an_admin_hand_over_cannot_be_accepted_during_a_wind_down` |
| Timing rules hold for any clock values (property tests) | [`contracts/async-vault/src/test/timing.rs`](../contracts/async-vault/src/test/timing.rs) | `standard_priceable_at_never_precedes_the_close`, `a_notice_that_would_overflow_has_no_end` |

## Events

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| The vault publishes each step of a deposit with its amounts, a cancellation of either side, and a refund for a deposit priced at zero shares | [`contracts/async-vault/src/test/events.rs`](../contracts/async-vault/src/test/events.rs) | `requesting_a_deposit_publishes_the_request`, `closing_an_epoch_publishes_its_totals`, `pricing_an_epoch_publishes_the_share_price`, `claiming_the_last_deposit_publishes_the_shares_paid_and_the_settlement`, `cancelling_a_deposit_publishes_the_cancellation`, `a_deposit_priced_at_zero_shares_publishes_a_refund_not_a_cancellation`, `cancelling_a_redemption_publishes_the_cancellation` |
| A refused call publishes nothing | [`contracts/async-vault/src/test/events.rs`](../contracts/async-vault/src/test/events.rs) | `a_refused_call_publishes_nothing` |
| An epoch's rounding remainder is cleared once its last request settles, a settled epoch leaves nothing in the totals whatever the claim order (property test), and a request that can never settle (a refused redemption or a refused mint) keeps its epoch open | [`contracts/async-vault/src/test/settlement.rs`](../contracts/async-vault/src/test/settlement.rs) | `the_last_redemption_claim_clears_the_cash_remainder_and_says_so_once`, `an_epoch_with_no_requests_settles_when_it_is_priced`, `a_settled_epoch_leaves_no_remainder_in_the_totals`, `a_request_that_cannot_settle_keeps_its_epoch_open`, `a_refused_mint_keeps_a_priced_deposit_epoch_open` |
| The oracle publishes the valuation it stored, with its proof reference | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `attesting_publishes_the_stored_valuation`, `a_proof_uri_at_the_limit_is_stored_and_published` |
| The vault publishes the end of its setup, and an applied change publishes its own event before `ChangeApplied` | [`contracts/async-vault/src/test/setup.rs`](../contracts/async-vault/src/test/setup.rs), [`contracts/async-vault/src/test/governance.rs`](../contracts/async-vault/src/test/governance.rs) | `finishing_setup_publishes_it`, `applying_a_custodian_change_publishes_both_events` |

## Calls between contracts

The vault tests deploy the real share token, identity verifier, compliance
contract and oracle, plus a Stellar Asset Contract for the deposit asset. The
fixture wires them as the deploy does, finishes the vault's setup, then posts
an opening report and moves the clock one second on, so deposits are taken and
the next sealed epoch is not priced by that report. `setup_unfinished()` and
`miswired(…)` leave the setup open.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| Deposit asset (Stellar Asset Contract) moves in and out | [`contracts/async-vault/src/test/deposit.rs`](../contracts/async-vault/src/test/deposit.rs), [`contracts/async-vault/src/test/treasury.rs`](../contracts/async-vault/src/test/treasury.rs), [`contracts/async-vault/src/test/clawback.rs`](../contracts/async-vault/src/test/clawback.rs) | `request_deposit_updates_epoch_and_user_state`, `capital_makes_the_round_trip_to_the_custodian`, `a_cancellation_the_balance_cannot_cover_is_refused_by_name` |
| The vault mints and burns shares through its role on the share token | [`contracts/async-vault/src/test/constructor.rs`](../contracts/async-vault/src/test/constructor.rs), [`contracts/async-vault/src/test/redeem.rs`](../contracts/async-vault/src/test/redeem.rs) | `the_vault_holds_the_manager_role_on_the_share_token`, `claim_redeem_pays_assets_and_burns_the_shares` |
| The vault checks the identity verifier at request; the share token checks it on mint and transfer | [`contracts/async-vault/src/test/compliance.rs`](../contracts/async-vault/src/test/compliance.rs), [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs) | `an_investor_who_was_never_allowlisted_is_refused_before_any_cash_moves`, `a_frozen_or_delisted_holder_cannot_transfer_shares`, `manager_mints_to_allowlisted_account` |
| The vault returns escrowed shares as the token's `manager` after checking the receiver itself, including the compliance contract's `can_transfer`; neither its own allowlist place nor the token pause stops a return | [`contracts/async-vault/src/test/share_returns.rs`](../contracts/async-vault/src/test/share_returns.rs) | `a_delisted_vault_still_returns_escrowed_shares`, `a_token_pause_stops_trading_but_not_a_share_return`, `a_return_the_compliance_rules_refuse_stays_escrowed` |
| The vault reads the oracle and refuses a stale or paused feed | [`contracts/async-vault/src/test/oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs), [`contracts/async-vault/src/test/deposit.rs`](../contracts/async-vault/src/test/deposit.rs) | `the_epoch_is_priced_at_the_attestation`, `fulfill_is_rejected_once_the_feed_goes_stale`, `a_paused_feed_is_refused_by_the_vault_not_the_oracle`, `a_deposit_is_refused_while_the_feed_is_stale`, `a_deposit_is_refused_while_the_nav_is_paused`, `a_deposit_is_refused_before_the_first_report` |
| The vault finishes setup only once the token and the oracle report it with their own setup closed, it is the token's only `manager`, the token has no shares outstanding, it passes the identity check, its address is not frozen, the token is bound to compliance (which runs on this vault's clock with its setup closed unless it is an external module that does not answer `VaultBinding`), the asset has the token's decimals, the asset, token, oracle and vault have four different addresses, the oracle answers as a feed, a custodian other than the vault is set, and the vault's own books are empty (the first epoch, with no deposit or redemption booked in it, nothing committed, and no shares owed or to burn). `health()` reports each check, and before setup finishes the vault takes no request and moves no epoch | [`contracts/async-vault/src/test/setup.rs`](../contracts/async-vault/src/test/setup.rs), [`contracts/async-vault/src/test/health.rs`](../contracts/async-vault/src/test/health.rs) | `every_wiring_step_is_checked_before_setup_finishes`, `each_missing_wiring_step_shows_in_its_own_flag`, `a_token_that_cannot_answer_fails_its_checks_instead_of_trapping`, `a_compliance_contract_from_outside_the_kit_is_accepted`, `a_deposit_before_setup_finishes_is_refused`, `a_redemption_before_setup_finishes_is_refused`, `no_epoch_is_sealed_or_priced_before_setup_finishes`, `a_redemption_planted_during_setup_never_reaches_a_depositor`, `setup_finishes_after_cash_is_funded_during_it`, `setup_cannot_finish_while_a_hand_over_is_pending` |
| The vault is never its own custodian: the direct setter, during setup and after, and a `Custodian` change, when proposed and when applied, refuse it with `InvalidCustodian` | [`contracts/async-vault/src/test/treasury.rs`](../contracts/async-vault/src/test/treasury.rs), [`contracts/async-vault/src/test/governance.rs`](../contracts/async-vault/src/test/governance.rs), [`contracts/async-vault/src/test/guards.rs`](../contracts/async-vault/src/test/guards.rs) | `setting_the_vault_as_its_own_custodian_is_refused`, `a_custodian_change_to_the_vault_is_refused_when_proposed_and_when_applied`, `custodian_not_the_vault_refuses_the_vault_itself` |
| The share token swaps to new compliance rules only if they list the token and, when they answer `vault()` and `setup_open()`, run on the vault's clock with their setup closed (`ComplianceNotBound`); as at setup, rules that do not answer them count as an external module and are accepted. It swaps to a new verifier only if the verifier accepts the vault (`VerifierRefusesVault`). Both are checked when proposed and again when applied; rules that do not answer `linked_tokens` and a verifier that does not answer are refused | [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs), [`contracts/share-token/src/test_guards.rs`](../contracts/share-token/src/test_guards.rs), [`contracts/async-vault/src/test/compliance.rs`](../contracts/async-vault/src/test/compliance.rs) | `rules_off_this_vaults_clock_or_without_the_token_are_never_proposed`, `rules_that_stop_qualifying_are_never_installed`, `rules_from_outside_the_kit_are_installed_while_they_list_the_token`, `rules_that_stop_answering_a_binding_view_are_installed_as_external`, `a_verifier_that_refuses_the_vault_or_cannot_answer_is_never_proposed`, `a_verifier_that_stops_accepting_the_vault_is_never_installed`, `applied_rule_and_verifier_changes_take_effect`, `an_unbound_compliance_swap_is_refused_and_every_move_goes_on` |
| Upgrading replaces the vault's code and migrates once | [`contracts/async-vault/src/test/upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs) (needs `upgrade_wasm`) | `applying_a_wasm_change_replaces_the_code`, `a_migration_refuses_a_second_run` |
| The share token upgrades through the vault's timelock under live balances, an open deposit and an open redemption, and migrates once; called directly, `upgrade` does not exist | [`contracts/async-vault/src/test/upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs) (needs `upgrade_wasm`) | `the_token_upgrades_under_live_balances_and_open_requests`, `the_token_exposes_no_immediate_upgrade` |
| The oracle upgrades through the vault's timelock under a live valuation, keeps its config, roles and vault, and migrates once; called directly, `upgrade` does not exist | [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs) (needs `upgrade_wasm`) | `the_oracle_upgrades_under_a_live_valuation`, `the_oracle_exposes_no_immediate_upgrade` |
| An oracle upgraded in place cannot read a report an earlier release stored; pausing the NAV, clearing the report and lifting the pause let the attester post a new one | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `a_report_of_the_earlier_shape_is_cleared_and_replaced` |

The harness's own attestations, from its tests and `npm run seed`, carry the
SHA-256 of [`docs/evidence/sample-valuation.md`](./evidence/sample-valuation.md),
a sample marked as test data, and a URL to it. By default the URL is the file's
raw copy on `main`, which resolves once the file is on `main`; the hash then
matches only while that copy is unchanged. With `PROOF_URI` pointing at a
release tag's copy, the URL and the hash name the same bytes for good.

## Contract spec docs and error codes

The contract spec keeps the first 1,024 bytes of each doc and drops the rest
without a warning. Each contract's error codes stay inside the block
`crates/strata-bindings` gives it.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| Every entrypoint and error variant doc of the five contracts fits in 1,024 bytes | [`crates/strata-bindings/tests/spec_docs.rs`](../crates/strata-bindings/tests/spec_docs.rs) | `every_contract_doc_fits_the_spec` |
| An error enum declared through `error_enum!` compiles only while every code stays in its contract's block | [`crates/strata-bindings/src/errors.rs`](../crates/strata-bindings/src/errors.rs) (doctests) | the in-range example compiles; the out-of-range one fails with `E0080` |

## Wind-down on the network

`scripts/harness/wind-down.test.ts` deploys a throwaway vault set on the local
network from a vault built with `--features short_wind_down`. That build drops
the seven-day minimum and carries a `build` meta entry, and is never deployed
elsewhere. The test runs a deposit, a claim, a redeem request, a wind-down, a
round and a claim, then checks that every function in the vault's spec was
called through the generated client. The full wind-down logic is tested in
Rust (`contracts/async-vault/src/test/wind_down.rs`), down to a round of one
asset unit at the lowest price the oracle allows
(`a_round_of_one_unit_at_the_lowest_price_still_credits_it`,
`at_the_lowest_price_holders_collect_the_reserve_less_a_unit_each`) and a claim
view that shows what the claim pays and fails where it fails
(`the_claimable_view_shows_what_the_claim_then_pays`,
`the_claimable_view_and_the_claim_fail_alike_at_the_overflow_edge`). The
testnet run is spread over seven days in the Tranche 2 release.

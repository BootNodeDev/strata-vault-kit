# Testing

Where the tests are that cover storage, TTL and host behaviour. Every contract
test runs against the in-memory Soroban `Env`, so the host's storage, auth,
ledger and event rules are the real ones, not mocks.

## Running them

```sh
SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 nix develop -c cargo test
```

The variable is needed whenever `cargo` runs directly (see
[AGENTS.md](../AGENTS.md)). The tests that upgrade the vault to a real WASM
build run only with `--features upgrade_wasm`, after the fixture in
[`fixtures/upgrade-target`](../fixtures/upgrade-target) is built.

## Storage and TTL

The contracts read and write through the shared helpers in
[`crates/storage`](../crates/storage/src/lib.rs). A write extends the entry to
30 days; a read that finds the entry extends it again once it has fallen more
than a day short. The instance follows the same rule.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| Persistent entries round-trip and get the full TTL on write | [`crates/storage/src/test.rs`](../crates/storage/src/test.rs) | `persistent_round_trips`, `writing_sets_the_full_ttl` |
| A read restores a decayed entry; a missing entry is not created | [`crates/storage/src/test.rs`](../crates/storage/src/test.rs) | `reading_a_decayed_entry_restores_the_full_ttl`, `reading_a_missing_entry_creates_nothing` |
| Instance writes and reads extend the contract instance | [`crates/storage/src/test.rs`](../crates/storage/src/test.rs) | `instance_writes_bump_the_instance`, `reading_the_instance_restores_its_ttl` |
| Vault requests and epochs are written with the full TTL | [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs) | `a_request_and_its_epoch_are_written_with_the_full_ttl`, `a_redemption_request_is_written_with_the_full_ttl` |
| Reading a vault request, epoch or the instance restores its TTL | [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs) | `reading_a_decayed_request_restores_its_full_ttl`, `reading_a_decayed_epoch_restores_its_full_ttl`, `any_vault_read_restores_the_instance_ttl` |
| A request still claims, and a wind-down position still pays, after most of a month | [`contracts/async-vault/src/test/ttl.rs`](../contracts/async-vault/src/test/ttl.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `a_pending_request_still_claims_after_most_of_a_month`, `a_position_survives_the_ledger_advancing` |
| The oracle's latest valuation keeps a full TTL while it is read | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `the_latest_valuation_keeps_a_full_ttl_while_it_is_read` |
| An epoch that was never written reads as nothing | [`contracts/async-vault/src/test/constructor.rs`](../contracts/async-vault/src/test/constructor.rs) | `unwritten_epoch_reads_as_none`, `epoch_zero_is_the_absent_id` |

The test `Env` does not archive an entry whose TTL runs out; it still reads it.
So these tests check the TTL numbers the contracts set, not what the network
does once an entry is archived.

The share token's balances and roles are stored by the OpenZeppelin Stellar
library, which manages their TTL itself.

## Authorization

Most tests sign every call with `mock_all_auths`. A refusal test then clears
all signatures with `set_auths(&[])` and checks the call fails and changes
nothing.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| A deposit is one investor signature that covers the vault call and the asset transfer inside it | [`contracts/async-vault/src/test/deposit.rs`](../contracts/async-vault/src/test/deposit.rs) | `one_investor_signature_covers_the_request_and_the_transfer` |
| Investor calls refuse without the investor's signature | [`contracts/async-vault/src/test/deposit.rs`](../contracts/async-vault/src/test/deposit.rs), [`contracts/async-vault/src/test/redeem.rs`](../contracts/async-vault/src/test/redeem.rs) | `request_deposit_needs_the_investor_authorisation`, `claiming_needs_the_investor_authorisation`, `request_redeem_needs_the_holder_authorisation` |
| Role calls refuse without the role holder's signature | [`contracts/async-vault/src/test/epochs.rs`](../contracts/async-vault/src/test/epochs.rs), [`contracts/async-vault/src/test/notice.rs`](../contracts/async-vault/src/test/notice.rs), [`contracts/async-vault/src/test/treasury.rs`](../contracts/async-vault/src/test/treasury.rs), [`contracts/async-vault/src/test/deposit_cap.rs`](../contracts/async-vault/src/test/deposit_cap.rs) | `closing_needs_the_manager_authorisation`, `setting_the_notice_needs_governance_authorisation`, `setting_the_custodian_needs_the_admin_signature`, `unauthorized_caller_rejected` |
| Guardian, governance and upgrade powers stay with their role | [`contracts/async-vault/src/test/controls.rs`](../contracts/async-vault/src/test/controls.rs), [`contracts/async-vault/src/test/upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `the_guardian_pauses_but_only_governance_unpauses`, `only_governance_proposes_and_cancels`, `only_governance_applies`, `only_governance_sets_the_delay` |
| Roles that must stay separate are refused at deployment | [`contracts/async-vault/src/test/constructor.rs`](../contracts/async-vault/src/test/constructor.rs) | `the_treasury_may_not_also_be_the_guardian`, `compliance_may_not_also_be_governance` |
| Share token: only the right role mints, burns, pauses, freezes or moves shares | [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs) | `unauthorized_caller_cannot_mint`, `unauthorized_caller_cannot_burn`, `unauthorized_caller_cannot_forced_transfer`, `unauthorized_caller_cannot_freeze_or_recover` |
| Oracle: only the attester posts, only the guardian raises the ripcord | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `attest_is_role_gated`, `raising_the_ripcord_is_limited_to_the_guardian`, `only_admin_can_set_config` |
| Identity verifier: only the admin edits the allowlist | [`contracts/identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs) | `only_admin_can_allow` |

## Ledger time and sequence

The vault fixture's `advance` moves the ledger timestamp and sequence together,
so time rules and TTL can be reached in one test.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| The test clock moves time and sequence | [`contracts/async-vault/src/test/controls.rs`](../contracts/async-vault/src/test/controls.rs) | `the_clock_helper_moves_time_and_sequence` |
| Closing records the ledger time; pricing waits for the notice period | [`contracts/async-vault/src/test/notice.rs`](../contracts/async-vault/src/test/notice.rs) | `closing_records_the_moment_and_the_wait`, `an_epoch_cannot_be_priced_inside_its_notice`, `it_is_priced_once_the_notice_elapses` |
| A valuation must be newer than the epoch close | [`contracts/async-vault/src/test/oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs) | `an_epoch_is_not_priced_against_a_valuation_older_than_its_close`, `a_valuation_taken_in_the_closing_ledger_prices_the_epoch` |
| Oracle freshness, cooldown and its own timestamp | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `heartbeat_expiry_makes_it_stale`, `attest_enforces_cooldown_and_deviation`, `attest_stamps_its_own_timestamp` |
| Upgrade and wind-down timelocks follow the ledger clock | [`contracts/async-vault/src/test/upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs), [`contracts/async-vault/src/test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) | `applying_before_the_eta_is_refused`, `a_pause_freezes_the_upgrade_timelock_clock`, `governance_proposes_and_anyone_activates_after_the_delay` |
| Timing rules hold for any clock values (property tests) | [`contracts/async-vault/src/test/timing.rs`](../contracts/async-vault/src/test/timing.rs) | `standard_priceable_at_never_precedes_the_close`, `a_notice_that_would_overflow_saturates` |

## Events

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| The vault publishes each step of a deposit with its amounts | [`contracts/async-vault/src/test/events.rs`](../contracts/async-vault/src/test/events.rs) | `requesting_a_deposit_publishes_the_request`, `closing_an_epoch_publishes_its_totals`, `pricing_an_epoch_publishes_the_share_price`, `claiming_a_deposit_publishes_the_shares_paid` |
| A refused call publishes nothing | [`contracts/async-vault/src/test/events.rs`](../contracts/async-vault/src/test/events.rs) | `a_refused_call_publishes_nothing` |
| The oracle publishes the valuation it stored | [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) | `attesting_publishes_the_stored_valuation` |

## Calls between contracts

The vault tests deploy the real share token, identity verifier, compliance
contract and oracle, plus a Stellar Asset Contract for the deposit asset.

| Behaviour | Tests | Key test names |
| --- | --- | --- |
| Deposit asset (Stellar Asset Contract) moves in and out | [`contracts/async-vault/src/test/deposit.rs`](../contracts/async-vault/src/test/deposit.rs), [`contracts/async-vault/src/test/treasury.rs`](../contracts/async-vault/src/test/treasury.rs) | `request_deposit_updates_epoch_and_user_state`, `capital_makes_the_round_trip_to_the_custodian` |
| The vault mints and burns shares through its role on the share token | [`contracts/async-vault/src/test/constructor.rs`](../contracts/async-vault/src/test/constructor.rs), [`contracts/async-vault/src/test/redeem.rs`](../contracts/async-vault/src/test/redeem.rs) | `the_vault_holds_the_manager_role_on_the_share_token`, `claim_redeem_pays_assets_and_burns_the_shares` |
| The share token checks the identity verifier on mint and transfer | [`contracts/async-vault/src/test/compliance.rs`](../contracts/async-vault/src/test/compliance.rs), [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs) | `a_non_allowlisted_investor_cannot_claim_shares`, `a_frozen_or_delisted_holder_cannot_transfer_shares`, `manager_mints_to_allowlisted_account` |
| The vault reads the oracle and refuses a stale or paused feed | [`contracts/async-vault/src/test/oracle_pricing.rs`](../contracts/async-vault/src/test/oracle_pricing.rs) | `the_epoch_is_priced_at_the_attestation`, `fulfill_is_rejected_once_the_feed_goes_stale`, `a_paused_feed_is_refused_by_the_vault_not_the_oracle` |
| Upgrading replaces the vault's code and migrates once | [`contracts/async-vault/src/test/upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs) (needs `upgrade_wasm`) | `applying_a_wasm_proposal_replaces_the_code`, `a_migration_refuses_a_second_run` |
